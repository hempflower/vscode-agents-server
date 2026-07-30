import { logger } from "@coder/logger"
import * as crypto from "crypto"
import * as express from "express"
import { rateLimit } from "express-rate-limit"
import { promises as fs, unlinkSync } from "fs"
import * as http from "http"
import * as net from "net"
import * as os from "os"
import * as path from "path"
import { logError, normalize } from "../../common/util"
import { CodeArgs, toCodeArgs } from "../cli"
import { isDevMode, vsRootPath } from "../constants"
import { authenticated, ensureAuthenticated, ensureOrigin, redirect, replaceTemplates } from "../http"
import { SocketProxyProvider } from "../socket"
import { isFile } from "../util"
import { type WebsocketRequest, Router as WsRouter } from "../wsRouter"

export const router = express.Router()

export const wsRouter = WsRouter()

// Authentication itself is handled by the login route, which has a stricter
// limiter.  This limiter protects session-cookie checks without throttling
// authenticated users or deployments running with --auth none.
const unauthenticatedRequestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: authenticated,
})

/**
 * The API of VS Code's web client server.  code-server delegates requests to VS
 * Code here.
 *
 * @see ../../../lib/vscode/src/vs/server/node/server.main.ts:72
 */
export interface IVSCodeServerAPI {
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>
  handleUpgrade(req: http.IncomingMessage, socket: net.Socket): void
  handleServerError(err: Error): void
  dispose(): void
}

/**
 * VS Code's CLI entrypoint (../../../lib/vscode/src/server-main.js).
 *
 * Normally VS Code will run `node server-main.js` which starts either the web
 * server or the CLI (for installing extensions, etc) but we patch it so we can
 * `require` it and call its functions directly in order to integrate with our
 * web server.
 */
export type VSCodeModule = {
  // See ../../../lib/vscode/src/server-main.js:339.
  loadCodeWithNls(): Promise<{
    // See ../../../lib/vscode/src/vs/server/node/server.main.ts:72.
    createServer(address: string | net.AddressInfo | null, args: CodeArgs): Promise<IVSCodeServerAPI>
    // See ../../../lib/vscode/src/vs/server/node/server.main.ts:65.
    spawnCli(args: CodeArgs): Promise<void>
  }>
}

/**
 * Load then create the VS Code server.
 */
let byokBootstrapConfig: string | undefined
let hasCapturedByokBootstrap = false
let ownedAgentHostSocketPath: string | undefined

async function loadVSCode(req: express.Request): Promise<IVSCodeServerAPI> {
  if (!hasCapturedByokBootstrap) {
    byokBootstrapConfig = req.args["agent-host-byok-config"]
    delete req.args["agent-host-byok-config"]
    hasCapturedByokBootstrap = true
  }
  // Since server-main.js is an ES module, we have to use `import`.  However,
  // tsc will transpile this to `require` unless we change our module type,
  // which will also require that we switch to ESM, since a hybrid approach
  // breaks importing `rotating-file-stream` for some reason.  To work around
  // this, use `eval` for now, but we should consider switching to ESM.
  let modPath = path.join(vsRootPath, "out/server-main.js")
  if (os.platform() === "win32") {
    // On Windows, absolute paths of ESM modules must be a valid file URI.
    modPath = "file:///" + modPath.replace(/\\/g, "/")
  }
  const mod = (await eval(`import("${modPath}")`)) as VSCodeModule
  const serverModule = await mod.loadCodeWithNls()
  let agentHostPath: string | undefined
  if (os.platform() === "linux") {
    const instanceHash = crypto.createHash("sha256").update(req.args["user-data-dir"]).digest("hex").slice(0, 16)
    const runtimeRoot = process.env.XDG_RUNTIME_DIR || os.tmpdir()
    const agentHostDirectory = path.join(runtimeRoot, `code-server-${process.getuid?.() ?? "user"}`, instanceHash)
    await fs.mkdir(agentHostDirectory, { recursive: true, mode: 0o700 })
    await fs.chmod(agentHostDirectory, 0o700)
    agentHostPath = path.join(agentHostDirectory, "agent-host.sock")
    await prepareAgentHostSocket(agentHostPath)
    ownedAgentHostSocketPath = agentHostPath
  }
  return serverModule.createServer(null, {
    ...(await toCodeArgs(req.args)),
    "accept-server-license-terms": true,
    // This seems to be used to make the connection token flags optional (when
    // set to 1.63) but we have always included them.
    compatibility: "1.64",
    "without-connection-token": true,
    "agent-host-path": agentHostPath,
    "agent-host-byok-config": agentHostPath ? byokBootstrapConfig : undefined,
  })
}

async function prepareAgentHostSocket(socketPath: string): Promise<void> {
  const active = await new Promise<boolean>((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out checking Agent Host socket ${socketPath}`))
    }, 500)
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      socket.destroy()
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        resolve(false)
      } else {
        reject(error)
      }
    })
  })
  if (active) {
    throw new Error(`An Agent Host is already listening for this user-data-dir at ${socketPath}`)
  }
  try {
    await fs.unlink(socketPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }
}

// To prevent loading the module more than once at a time.  We also have the
// resolved value so you do not need to `await` everywhere.
let vscodeServerPromise: Promise<IVSCodeServerAPI> | undefined

// The resolved value from the dynamically loaded VS Code server.  Do not use
// without first calling and awaiting `ensureCodeServerLoaded`.
let vscodeServer: IVSCodeServerAPI | undefined

/**
 * Ensure the VS Code server is loaded.
 */
export const ensureVSCodeLoaded = async (
  req: express.Request,
  _: express.Response,
  next: express.NextFunction,
): Promise<void> => {
  if (vscodeServer) {
    return next()
  }
  if (!vscodeServerPromise) {
    vscodeServerPromise = loadVSCode(req)
  }
  try {
    vscodeServer = await vscodeServerPromise
  } catch (error) {
    vscodeServerPromise = undefined // Unset so we can try again.
    logError(logger, "CodeServerRouteWrapper", error)
    if (isDevMode) {
      return next(
        new Error(
          (error instanceof Error ? error.message : error) +
            " (Have you applied the patches? If so, VS Code may still be compiling)",
        ),
      )
    }
    return next(error)
  }
  return next()
}

// This distribution exposes only the dedicated Agents window.  Keep the
// editor route out of the catch-all VS Code handler as well, including when
// this router is mounted below a reverse-proxy prefix.
router.all(["/editor", "/editor/"], (_req, res) => res.sendStatus(404))

router.get(["/", "/agents", "/agents/"], unauthenticatedRequestLimiter, async (req, res, next) => {
  const requestedPath = new URL(req.originalUrl, "http://localhost").pathname
  const currentRoute = normalize(requestedPath, requestedPath.endsWith("/")) || "/"
  const isAuthenticated = await authenticated(req)
  const NO_FOLDER_OR_WORKSPACE_QUERY = !req.query.folder && !req.query.workspace
  // Ew means the workspace was closed so clear the last folder/workspace.
  const FOLDER_OR_WORKSPACE_WAS_CLOSED = req.query.ew

  if (!isAuthenticated) {
    const to = currentRoute
    return redirect(req, res, "login", {
      to: to !== "/" ? to : undefined,
    })
  }

  // The authenticated VS Code web server redirects the legacy /agents route
  // to the root Agents surface while preserving its query string.
  if (req.path === "/agents" || req.path === "/agents/") {
    return next()
  }

  if (NO_FOLDER_OR_WORKSPACE_QUERY && !FOLDER_OR_WORKSPACE_WAS_CLOSED) {
    const settings = await req.settings.read()
    const lastOpened = settings.query || {}
    // This flag disables the last opened behavior
    const IGNORE_LAST_OPENED = req.args["ignore-last-opened"]
    const HAS_LAST_OPENED_FOLDER_OR_WORKSPACE = lastOpened.folder || lastOpened.workspace
    const HAS_FOLDER_OR_WORKSPACE_FROM_CLI = req.args._.length > 0
    const to = currentRoute

    let folder = undefined
    let workspace = undefined

    // Redirect to the last folder/workspace if nothing else is opened.
    if (HAS_LAST_OPENED_FOLDER_OR_WORKSPACE && !IGNORE_LAST_OPENED) {
      folder = lastOpened.folder
      workspace = lastOpened.workspace
    } else if (HAS_FOLDER_OR_WORKSPACE_FROM_CLI) {
      const lastEntry = path.resolve(req.args._[req.args._.length - 1])
      const entryIsFile = await isFile(lastEntry)
      const IS_WORKSPACE_FILE = entryIsFile && path.extname(lastEntry) === ".code-workspace"

      if (IS_WORKSPACE_FILE) {
        workspace = lastEntry
      } else if (!entryIsFile) {
        folder = lastEntry
      }
    }

    if (folder || workspace) {
      return redirect(req, res, to, {
        folder,
        workspace,
      })
    }
  }

  // Store the query parameters so we can use them on the next load.  This
  // also allows users to create functionality around query parameters.
  await req.settings.write({ query: req.query })

  next()
})

router.get("/manifest.json", async (req, res) => {
  res.writeHead(200, { "Content-Type": "application/manifest+json" })

  res.end(
    replaceTemplates(
      req,
      JSON.stringify(
        {
          name: req.args["app-name"],
          short_name: req.args["app-name"],
          start_url: ".",
          display: "fullscreen",
          display_override: ["window-controls-overlay"],
          description: "Run Code on a remote server.",
          icons: [192, 512]
            .map((size) => [
              {
                src: `{{BASE}}/_static/src/browser/media/pwa-icon-${size}.png`,
                type: "image/png",
                sizes: `${size}x${size}`,
                purpose: "any",
              },
              {
                src: `{{BASE}}/_static/src/browser/media/pwa-icon-maskable-${size}.png`,
                type: "image/png",
                sizes: `${size}x${size}`,
                purpose: "maskable",
              },
            ])
            .flat(),
        },
        null,
        2,
      ),
    ),
  )
})

let mintKeyPromise: Promise<Buffer> | undefined
router.post("/mint-key", async (req, res) => {
  if (!mintKeyPromise) {
    mintKeyPromise = new Promise(async (resolve) => {
      const keyPath = path.join(req.args["user-data-dir"], "serve-web-key-half")
      logger.debug(`Reading server web key half from ${keyPath}`)
      try {
        resolve(await fs.readFile(keyPath))
        return
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          logError(logger, `read ${keyPath}`, error)
        }
      }
      // VS Code wants 256 bits.
      const key = crypto.randomBytes(32)
      try {
        await fs.writeFile(keyPath, key)
      } catch (error: any) {
        logError(logger, `write ${keyPath}`, error)
      }
      resolve(key)
    })
  }
  const key = await mintKeyPromise
  res.end(key)
})

router.all(/^\/(?:agents\/?)?$/, unauthenticatedRequestLimiter, ensureAuthenticated)

router.all(/.*/, ensureAuthenticated, ensureVSCodeLoaded, async (req, res) => {
  vscodeServer!.handleRequest(req, res)
})

const socketProxyProvider = new SocketProxyProvider()
wsRouter.ws(/.*/, ensureOrigin, ensureAuthenticated, ensureVSCodeLoaded, async (req: WebsocketRequest) => {
  const wrappedSocket = await socketProxyProvider.createProxy(req.ws)
  // This should actually accept a duplex stream but it seems Code has not
  // been updated to match the Node 16 types so cast for now.  There does not
  // appear to be any code specific to sockets so this should be fine.
  vscodeServer!.handleUpgrade(req, wrappedSocket as net.Socket)

  req.ws.resume()
})

export function dispose() {
  vscodeServer?.dispose()
  if (ownedAgentHostSocketPath) {
    try {
      unlinkSync(ownedAgentHostSocketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logError(logger, `unlink ${ownedAgentHostSocketPath}`, error)
      }
    }
    ownedAgentHostSocketPath = undefined
  }
  socketProxyProvider.stop()
}
