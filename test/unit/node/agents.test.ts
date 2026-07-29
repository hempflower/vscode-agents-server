import {
  byokConfigurationEnvironmentVariable,
  consumeByokBootstrapEnvironment,
} from "../../../src/node/agents"
import { redactArgs } from "../../../src/node/cli"

describe("Agent Host BYOK bootstrap", () => {
  it("captures referenced keys and removes all BYOK variables from the child environment", () => {
    const environment: NodeJS.ProcessEnv = {
      [byokConfigurationEnvironmentVariable]: JSON.stringify({
        version: 1,
        providers: [
          { id: "openai", type: "openai", baseUrl: "https://example.test/v1", apiKeyEnv: "OPENAI_TEST_KEY" },
          { id: "anthropic", type: "anthropic", baseUrl: "https://example.test", apiKeyEnv: "ANTHROPIC_TEST_KEY" },
        ],
      }),
      OPENAI_TEST_KEY: "openai-secret",
      ANTHROPIC_TEST_KEY: "anthropic-secret",
      UNRELATED: "preserved",
    }

    const payload = consumeByokBootstrapEnvironment(environment)

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

  it("turns malformed JSON into a disabled, non-secret bootstrap payload", () => {
    const environment: NodeJS.ProcessEnv = {
      [byokConfigurationEnvironmentVariable]: "not-json",
      OPENAI_TEST_KEY: "untouched-because-it-was-not-referenced",
    }

    expect(consumeByokBootstrapEnvironment(environment)).toEqual({
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
