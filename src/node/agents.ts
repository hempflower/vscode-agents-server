export const byokConfigurationEnvironmentVariable = "CODE_SERVER_AGENTS_BYOK_CONFIG"

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

/**
 * Captures BYOK keys for the Agent Host, then removes them from the generic
 * process environment before VS Code can spawn extension or tool processes.
 */
export function consumeByokBootstrapEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ByokBootstrapPayload | undefined {
  const rawConfiguration = environment[byokConfigurationEnvironmentVariable]
  delete environment[byokConfigurationEnvironmentVariable]
  if (!rawConfiguration) {
    return undefined
  }

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
