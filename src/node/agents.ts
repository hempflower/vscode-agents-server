import { promises as fs } from "fs"

interface ByokProviderReference {
  apiKeyEnv?: unknown
}

interface ByokConfigurationShape {
  providers?: unknown
}

export interface ByokBootstrapPayload {
  configuration: unknown
  secrets: Record<string, string>
}

function consumeByokBootstrapConfiguration(
  rawConfiguration: string,
  environment: NodeJS.ProcessEnv,
): ByokBootstrapPayload {
  let configuration: ByokConfigurationShape
  try {
    configuration = JSON.parse(rawConfiguration) as ByokConfigurationShape
  } catch {
    return { configuration: { version: 1, providers: [], error: "invalid_configuration" }, secrets: {} }
  }

  const secrets: Record<string, string> = {}
  if (Array.isArray(configuration.providers)) {
    for (const provider of configuration.providers as ByokProviderReference[]) {
      if (typeof provider?.apiKeyEnv !== "string" || !provider.apiKeyEnv) {
        continue
      }
      const value = environment[provider.apiKeyEnv]
      if (value) {
        secrets[provider.apiKeyEnv] = value
      }
      delete environment[provider.apiKeyEnv]
    }
  }

  return { configuration, secrets }
}

/**
 * Loads a BYOK catalogue from a file and captures its referenced keys before
 * VS Code can spawn extension or tool processes.
 */
export async function consumeByokBootstrapFile(
  configurationPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ByokBootstrapPayload> {
  const rawConfiguration = await fs.readFile(configurationPath, "utf8")
  return consumeByokBootstrapConfiguration(rawConfiguration, environment)
}
