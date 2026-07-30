import { promises as fs } from "fs"
import * as path from "path"
import { consumeByokBootstrapFile } from "../../../src/node/agents"
import { redactArgs } from "../../../src/node/cli"
import { tmpdir } from "../../utils/helpers"

describe("Agent Host BYOK bootstrap", () => {
  it("loads a catalogue file, captures referenced keys, and removes them from the child environment", async () => {
    const directory = await tmpdir("agents-byok-config")
    const configurationPath = path.join(directory, "byok.json")
    await fs.writeFile(
      configurationPath,
      JSON.stringify({
        version: 1,
        providers: [
          { id: "openai", type: "openai", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_TEST_KEY" },
          { id: "anthropic", type: "anthropic", baseUrl: "https://example.test", apiKeyEnv: "ANTHROPIC_TEST_KEY" },
        ],
      }),
    )
    const environment: NodeJS.ProcessEnv = {
      OPENAI_TEST_KEY: "openai-secret",
      ANTHROPIC_TEST_KEY: "anthropic-secret",
      UNRELATED: "preserved",
    }

    const payload = await consumeByokBootstrapFile(configurationPath, environment)

    expect(payload).toEqual({
      configuration: {
        version: 1,
        providers: [
          { id: "openai", type: "openai", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_TEST_KEY" },
          { id: "anthropic", type: "anthropic", baseUrl: "https://example.test", apiKeyEnv: "ANTHROPIC_TEST_KEY" },
        ],
      },
      secrets: {
        OPENAI_TEST_KEY: "openai-secret",
        ANTHROPIC_TEST_KEY: "anthropic-secret",
      },
    })
    expect(environment).toEqual({ UNRELATED: "preserved" })
  })

  it("turns malformed file JSON into a disabled, non-secret bootstrap payload", async () => {
    const directory = await tmpdir("agents-byok-invalid-config")
    const configurationPath = path.join(directory, "byok.json")
    await fs.writeFile(configurationPath, "not-json")
    const environment: NodeJS.ProcessEnv = {
      OPENAI_TEST_KEY: "untouched-because-it-was-not-referenced",
    }

    await expect(consumeByokBootstrapFile(configurationPath, environment)).resolves.toEqual({
      configuration: { version: 1, providers: [], error: "invalid_configuration" },
      secrets: {},
    })
    expect(environment).toEqual({ OPENAI_TEST_KEY: "untouched-because-it-was-not-referenced" })
  })

  it("redacts the supervisor IPC payload from argument logging", () => {
    expect(redactArgs({ "agent-host-byok-config": "secret-payload" })).toMatchObject({
      "agent-host-byok-config": "<redacted>",
    })
  })
})
