# Web Agents and server-side BYOK

On Linux, code-server starts and supervises a server-side Agent Host when the
first authenticated VS Code request initializes the server. The dedicated
Agents UI is served at `/`; the normal editor remains available at `/editor/`.
When code-server is mounted below a reverse-proxy path, use that path itself for
Agents (for example `/vscode/`) and append `/editor/` for the normal workbench.
The legacy `/agents/` route redirects to the Agents root.

Pass `--disable-agents` to disable both the route and the Agent Host. The route
returns `404` while disabled.

## BYOK configuration

Pass `--agents-byok-config <path>` to load a JSON catalogue. API keys are
referenced by environment variable name and are captured at process startup:

```json
{
  "version": 1,
  "providers": [
    {
      "id": "corp-openai",
      "type": "openai",
      "baseUrl": "https://gateway.example.com/v1",
      "apiKeyEnv": "CORP_OPENAI_API_KEY",
      "models": [
        {
          "id": "gpt-5",
          "name": "GPT-5",
          "maxContextWindowTokens": 128000,
          "maxOutputTokens": 16384,
          "supportsVision": true
        }
      ]
    },
    {
      "id": "anthropic-main",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "apiVersion": "2023-06-01",
      "models": [
        {
          "id": "claude-sonnet",
          "name": "Claude Sonnet",
          "maxContextWindowTokens": 200000
        }
      ]
    },
    {
      "id": "deepseek",
      "type": "deepseek",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": [
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek V4 Pro",
          "maxContextWindowTokens": 1000000,
          "maxOutputTokens": 128000,
          "supportedReasoningEfforts": ["none", "high", "max"],
          "defaultReasoningEffort": "high"
        }
      ]
    }
  ]
}
```

For example, save the catalogue as `/etc/code-server/byok.json`, export the
referenced keys, and start code-server with:

```shell
export CORP_OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export DEEPSEEK_API_KEY="..."
code-server --agents-byok-config /etc/code-server/byok.json
```

Model selection IDs use `<providerId>/<modelId>`. OpenAI-compatible requests use
`<baseUrl>/chat/completions`; Anthropic and DeepSeek requests use
`<baseUrl>/v1/messages`.
HTTP endpoints are rejected unless the provider explicitly sets
`"allowInsecureHttp": true`.

Use `type: "deepseek"` rather than the generic `anthropic` type for DeepSeek
thinking models. DeepSeek is then registered with the Copilot SDK as a native
Anthropic provider and uses the local `/v1/messages` bridge end to end, preserving
thinking blocks, signatures, tool uses, and grouped parallel tool results without
an OpenAI-format compatibility cache. Known DeepSeek rejections are reported as
deterministic codes such as
`missing_reasoning_content` and `context_length_exceeded`.

The catalogue and referenced keys are loaded once. Restart code-server after a
configuration or key change. Invalid top-level configuration disables the whole
environment catalogue. A missing key disables only its provider and is reported
with a sanitized status (`ready`, `degraded`, or `disabled`).

Keys are removed from the generic code-server environment before extension and
tool processes are started. They are delivered only to the Agent Host bootstrap
and are not included in browser configuration, persisted sessions, logs, or
telemetry. Prompt and response bodies are also omitted from default Agent Host
logs. Environment BYOK is exclusive: cached GitHub credentials are ignored,
authentication and Copilot network diagnostics are disabled, and provider or
proxy failures stop the session with a sanitized deterministic error instead of
falling back to GitHub Copilot subscription models.
