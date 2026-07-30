import { field, Logger, logger } from "@coder/logger"
import * as cp from "child_process"
import { promises as fs } from "fs"
import * as path from "path"
import { Page } from "playwright"
import { logError, normalize } from "../../../src/common/util"
import { onLine } from "../../../src/node/util"
import { PASSWORD, workspaceDir } from "../../utils/constants"
import { getMaybeProxiedCodeServer, idleTimer, tmpdir } from "../../utils/helpers"

interface CodeServerProcess {
  process: cp.ChildProcess
  address: string
}

/** A code-server instance used by an Agents-window end-to-end suite. */
export class CodeServer {
  private process: Promise<CodeServerProcess> | undefined
  public readonly logger: Logger
  private closed = false

  constructor(
    name: string,
    private readonly args: string[],
    private readonly env: NodeJS.ProcessEnv,
    private _workspaceDir: Promise<string> | string | undefined,
    private readonly entry = process.env.CODE_SERVER_TEST_ENTRY || ".",
  ) {
    this.logger = logger.named(name)
  }

  /** Start the instance if necessary and return its address. */
  async address(): Promise<string> {
    if (!this.process) {
      this.process = this.spawn()
    }
    return (await this.process).address
  }

  get workspaceDir(): Promise<string> | string {
    if (!this._workspaceDir) {
      this._workspaceDir = tmpdir(workspaceDir)
    }
    return this._workspaceDir
  }

  private async createWorkspace(): Promise<string> {
    const dir = await this.workspaceDir
    await fs.mkdir(path.join(dir, "User"), { recursive: true })
    await fs.writeFile(
      path.join(dir, "User/settings.json"),
      JSON.stringify({
        "workbench.startupEditor": "none",
        "workbench.welcomePage.experimentalOnboarding": false,
      }),
      "utf8",
    )
    return dir
  }

  private async spawn(): Promise<CodeServerProcess> {
    const dir = await this.createWorkspace()
    const args = [
      ...(await this.argsWithDefaults()),
      "--auth",
      "none",
      ...(this.args.includes("--ignore-last-opened") ? [] : [dir]),
      ...this.args,
      "--bind-addr",
      "127.0.0.1:0",
    ]

    return new Promise((resolve, reject) => {
      this.logger.debug("spawning `node " + args.join(" ") + "`")
      const proc = cp.spawn("node", args, {
        cwd: path.join(__dirname, "../../.."),
        env: {
          ...process.env,
          ...this.env,
          VSCODE_IPC_HOOK_CLI: "",
          PASSWORD,
        },
      })
      const timer = idleTimer("Failed to extract address; did the format change?", reject)

      proc.on("error", (error) => {
        this.logger.error(error.message)
        timer.dispose()
        reject(error)
      })
      proc.on("close", (code) => {
        if (!this.closed) {
          this.logger.error(
            "code-server closed unexpectedly. Try running with LOG_LEVEL=debug to see more info.",
            field("code", code),
          )
        }
        timer.dispose()
      })

      let httpAddress: string | undefined
      let sessionAddress: string | undefined
      let resolved = false
      proc.stdout.setEncoding("utf8")
      onLine(proc, (line) => {
        timer.reset()
        this.logger.debug(line.replace(/\[.+\]/, ""))
        if (resolved) {
          return
        }

        let match = line.trim().match(/HTTPS? server listening on (https?:\/\/[.:\d]+)\/?$/)
        if (match) {
          httpAddress = match[1].replace("127.0.0.1", "localhost")
        }
        match = line.trim().match(/Session server listening on (.+)$/)
        if (match) {
          sessionAddress = match[1]
        }
        if (httpAddress && sessionAddress) {
          resolved = true
          timer.dispose()
          this.logger.debug(`code-server is ready: ${httpAddress} ${sessionAddress}`)
          resolve({ process: proc, address: httpAddress })
        }
      })
    })
  }

  private async argsWithDefaults(): Promise<string[]> {
    const dir = await this.workspaceDir
    return [
      this.entry,
      "--extensions-dir",
      path.join(dir, "extensions"),
      "--config",
      path.join(dir, "config.yaml"),
      "--user-data-dir",
      dir,
    ]
  }

  /** Stop the server and wait until its Agent Host and extension hosts exit. */
  async close(): Promise<void> {
    logger.debug("closing")
    if (!this.process) {
      return
    }

    const proc = (await this.process).process
    this.closed = true
    const closed = new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve()
      } else {
        proc.once("close", () => resolve())
      }
    })
    proc.kill()
    await closed
  }

  authEnabled(): boolean {
    return this.args.includes("password")
  }
}

/** Page model for the dedicated Agents window. */
export class CodeServerPage {
  private readonly workbenchSelector = "div.monaco-workbench"

  constructor(
    private readonly codeServer: CodeServer,
    public readonly page: Page,
  ) {
    this.page.on("console", (message) => this.codeServer.logger.debug(message.text()))
    this.page.on("pageerror", (error) => logError(this.codeServer.logger, "page", error))
  }

  address() {
    return this.codeServer.address()
  }

  get workspaceDir() {
    return this.codeServer.workspaceDir
  }

  /** Navigate to the Agents root (or another explicit route). */
  async navigate(endpoint = "/") {
    const address = await getMaybeProxiedCodeServer(this.codeServer)
    const target = new URL(normalize(address + endpoint, true))
    this.codeServer.logger.info(`navigating to ${target}`)
    await this.page.goto(target.toString())

    if (!this.codeServer.authEnabled()) {
      await this.reloadUntilWorkbenchIsReady()
    }
  }

  async reloadUntilWorkbenchIsReady() {
    this.codeServer.logger.debug("Waiting for Agents workbench to be ready...")
    while (!(await this.isWorkbenchVisible())) {
      await this.page.waitForLoadState("load")
      await this.page.waitForTimeout(1000)
      await this.page.reload()
    }
    this.codeServer.logger.debug("Agents workbench is ready!")
  }

  async isWorkbenchVisible() {
    try {
      await this.page.waitForSelector(this.workbenchSelector, { timeout: 5000 })
      return await this.page.isVisible(this.workbenchSelector)
    } catch {
      return false
    }
  }
}
