import { runCodeServerCommand } from "../utils/runCodeServerCommand"

// NOTE@jsjoeio
// We have this test to ensure that native modules
// work as expected. If this is called on the wrong
// platform, the test will fail.
describe("--help", () => {
  it("should list vscode-agents-server usage", async () => {
    const expectedOutput = "Usage: vscode-agents-server [options] [path]"
    const { stdout } = await runCodeServerCommand(["--help"])
    expect(stdout).toMatch(expectedOutput)
  }, 20000)

  it("should require a BYOK configuration when starting the server", async () => {
    await expect(runCodeServerCommand([])).rejects.toMatchObject({
      stderr: expect.stringContaining("--agents-byok-config is required"),
    })
  }, 20000)
})
