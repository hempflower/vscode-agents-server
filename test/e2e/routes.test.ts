import { clean, getMaybeProxiedPathname } from "../utils/helpers"
import { describe, test, expect } from "./baseFixture"

const routes = {
  "/": [
    /\.\/manifest.json/,
    /\.\/_static\//,
    /[a-z]+-[0-9a-z]+\/static\//,
    /http:\/\/localhost:[0-9]+(?:\/[0-9]+\/ide)?\/[a-z]+-[0-9a-z]+\/static\//,
  ],
  "/vscode": [
    /\.\/vscode\/manifest.json/,
    /\.\/_static\//,
    /vscode\/[a-z]+-[0-9a-z]+\/static\//,
    /http:\/\/localhost:[0-9]+(?:\/[0-9]+\/ide)?\/vscode\/[a-z]+-[0-9a-z]+\/static\//,
  ],
  "/vscode/": [
    /\.\/manifest.json/,
    /\.\/\.\.\/_static\//,
    /[a-z]+-[0-9a-z]+\/static\//,
    /http:\/\/localhost:[0-9]+(?:\/[0-9]+\/ide)?\/vscode\/[a-z]+-[0-9a-z]+\/static\//,
  ],
}

describe("VS Code Routes", [], {}, async () => {
  const testName = "vscode-routes-default"
  test.beforeAll(async () => {
    await clean(testName)
  })

  test("should load all route variations", async ({ codeServerPage }) => {
    for (const [route, matchers] of Object.entries(routes)) {
      await codeServerPage.navigate(route)

      // Check there were no redirections
      const url = new URL(codeServerPage.page.url())
      const pathname = getMaybeProxiedPathname(url)
      expect(pathname).toBe(route)

      // Check that assets are pointing to the right spot.  Some will be
      // relative, without a leading dot (VS Code's assets).  Some will be
      // relative with a leading dot (our assets).  Others will have been
      // resolved against the origin.
      const elements = await codeServerPage.page.locator("[src]").all()
      for (const element of elements) {
        const src = await element.getAttribute("src")
        if (src && !matchers.some((m) => m.test(src))) {
          throw new Error(`${src} did not match any validators for route ${route}`)
        }
      }
    }
  })

  test("should redirect the legacy Agents route to root", async ({ codeServerPage }) => {
    const folder = process.env.CODE_FOLDER_DIR
    await codeServerPage.navigate(`/agents/?folder=${folder}`)
    const url = new URL(codeServerPage.page.url())
    expect(getMaybeProxiedPathname(url)).toBe("/")
    expect(url.searchParams.get("folder")).toBe(folder)
  })
})

describe("VS Code root Agents route authentication", ["--auth", "password"], {}, async () => {
  test("should require authentication", async ({ codeServer }) => {
    const response = await fetch(`${await codeServer.address()}/`, { redirect: "manual" })
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toContain("login")
  })
})

describe("VS Code editor route disabled", [], {}, async () => {
  test("should not expose editor routes", async ({ codeServer }) => {
    const address = await codeServer.address()
    expect((await fetch(`${address}/editor`)).status).toBe(404)
    expect((await fetch(`${address}/editor/`)).status).toBe(404)
    expect((await fetch(`${address}/vscode/editor/`)).status).toBe(404)
  })
})

const CODE_WORKSPACE_DIR = process.env.CODE_WORKSPACE_DIR || ""
describe("VS Code Routes with code-workspace", [CODE_WORKSPACE_DIR], {}, async () => {
  test("should redirect to the passed in workspace using human-readable query", async ({ codeServerPage }) => {
    await codeServerPage.navigate("/")
    const url = new URL(codeServerPage.page.url())
    const pathname = getMaybeProxiedPathname(url)
    expect(pathname).toBe("/")
    expect(url.search).toBe(`?workspace=${CODE_WORKSPACE_DIR}`)
  })
})

const CODE_FOLDER_DIR = process.env.CODE_FOLDER_DIR || ""
describe("VS Code Routes with code-workspace", [CODE_FOLDER_DIR], {}, async () => {
  test("should redirect to the passed in folder using human-readable query", async ({ codeServerPage }) => {
    await codeServerPage.navigate("/")
    const url = new URL(codeServerPage.page.url())
    const pathname = getMaybeProxiedPathname(url)
    expect(pathname).toBe("/")
    expect(url.search).toBe(`?folder=${CODE_FOLDER_DIR}`)
  })
})

describe("VS Code Routes with ignore-last-opened", ["--ignore-last-opened"], {}, async () => {
  test("should not redirect", async ({ codeServerPage }) => {
    const folder = process.env.CODE_FOLDER_DIR

    await codeServerPage.navigate(`/?folder=${folder}`)
    await codeServerPage.navigate(`/`)

    const url = new URL(codeServerPage.page.url())
    const pathname = getMaybeProxiedPathname(url)
    expect(pathname).toBe("/")
    expect(url.search).toBe("")
  })
})

describe("VS Code Routes with no workspace or folder", [], {}, async () => {
  test("should redirect to last query folder/workspace", async ({ codeServerPage }) => {
    const folder = process.env.CODE_FOLDER_DIR
    const workspace = process.env.CODE_WORKSPACE_DIR
    await codeServerPage.navigate(`/?folder=${folder}&workspace=${workspace}`)

    // If you visit again without query parameters it will re-attach them by
    // redirecting.  It should always redirect to the same route.
    for (const route of Object.keys(routes)) {
      await codeServerPage.navigate(route)
      const url = new URL(codeServerPage.page.url())
      const pathname = getMaybeProxiedPathname(url)
      expect(pathname).toBe(route)
      expect(url.search).toBe(`?folder=${folder}&workspace=${workspace}`)
    }
  })
})

describe("VS Code Routes with no workspace or folder", [], {}, async () => {
  test("should not redirect if ew passed in", async ({ codeServerPage }) => {
    const folder = process.env.CODE_FOLDER_DIR
    const workspace = process.env.CODE_WORKSPACE_DIR
    await codeServerPage.navigate(`/?folder=${folder}&workspace=${workspace}`)

    // Closing the folder should stop the redirecting.
    await codeServerPage.navigate("/?ew=true")
    const url = new URL(codeServerPage.page.url())
    const pathname = getMaybeProxiedPathname(url)
    expect(pathname).toBe("/")
    expect(url.search).toBe("?ew=true")
  })
})

describe("VS Code Routes with a stale workspace", [], {}, async () => {
  test("should clear an invalid folder query before loading the workbench", async ({ codeServer }) => {
    const address = await codeServer.address()
    const response = await fetch(`${address}/?folder=/tmp/code-server-folder-that-does-not-exist`, {
      redirect: "manual",
    })

    expect(response.status).toBe(302)
    const location = response.headers.get("location")
    expect(location).toBeTruthy()

    const url = new URL(location as string, address)
    expect(url.pathname).toBe("/")
    expect(url.search).toBe("?ew=true")
  })
})

describe(
  "VS Code Routes with a stale command-line workspace",
  ["/tmp/code-server-folder-that-does-not-exist"],
  {},
  async () => {
    test("should not pass the missing folder to VS Code", async ({ codeServer }) => {
      const response = await fetch(await codeServer.address(), { redirect: "manual" })

      expect(response.status).toBe(200)
    })
  },
)
