import { logger } from "@coder/logger"
import { consumeByokBootstrapFile } from "./agents"
import { optionDescriptions, parse, readConfigFile, setDefaults, shouldOpenInExistingInstance } from "./cli"
import { getVersionString, getVersionJsonString } from "./constants"
import { openInExistingInstance, runCodeServer, runCodeCli, shouldSpawnCliProcess } from "./main"
import { isChild, wrapper } from "./wrapper"

async function entry(): Promise<void> {
  // There's no need to check flags like --help or to spawn in an existing
  // instance for the child process because these would have already happened in
  // the parent and the child wouldn't have been spawned. We also get the
  // arguments from the parent so we don't have to parse twice and to account
  // for environment manipulation (like how PASSWORD gets removed to avoid
  // leaking to child processes).
  if (isChild(wrapper)) {
    const args = await wrapper.handshake()
    wrapper.preventExit()
    const server = await runCodeServer(args)
    wrapper.onDispose(() => server.dispose())
    return
  }

  const cliArgs = parse(process.argv.slice(2))
  const configArgs = await readConfigFile(cliArgs.config)
  const args = await setDefaults(cliArgs, configArgs)

  if (args.help) {
    console.log("vscode-agents-server", getVersionString())
    console.log("")
    console.log(`Usage: vscode-agents-server [options] [path]`)
    console.log(`    - Opening a directory: vscode-agents-server ./path/to/your/project`)
    console.log(`    - Opening a saved workspace: vscode-agents-server ./path/to/your/project.code-workspace`)
    console.log("")
    console.log("Options")
    optionDescriptions().forEach((description) => {
      console.log("", description)
    })
    return
  }

  if (args.version) {
    if (args.json) {
      console.log(getVersionJsonString())
    } else {
      console.log(getVersionString())
    }
    return
  }

  const byokConfigurationPath = args["agents-byok-config"]
  if (!byokConfigurationPath) {
    throw new Error("--agents-byok-config is required")
  }

  // Capture the catalogue and referenced secrets before the supervised server
  // child is forked. The payload crosses the existing one-shot parent/child IPC
  // handshake; only the scrubbed environment is inherited by subprocesses.
  delete args["agents-byok-config"]
  const byokBootstrap = await consumeByokBootstrapFile(byokConfigurationPath)
  args["agent-host-byok-config"] = JSON.stringify(byokBootstrap)

  if (shouldSpawnCliProcess(args)) {
    logger.debug("Found VS Code arguments; spawning VS Code CLI")
    return runCodeCli(args)
  }

  const socketPath = await shouldOpenInExistingInstance(cliArgs, args["session-socket"])
  if (socketPath) {
    logger.debug("Trying to open in existing instance")
    return openInExistingInstance(args, socketPath)
  }

  return wrapper.start(args)
}

entry().catch((error) => {
  logger.error(error.message)
  wrapper.exit(error)
})
