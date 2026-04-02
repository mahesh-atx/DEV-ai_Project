import fs from "fs";
import path from "path";

export const DEFAULT_COMMAND_POLICY = {
  dryRun: false,
  allowOutsideWorkspacePaths: false,
  commandTimeoutMs: 300000,
  installTimeoutMs: 120000,
  autoInstallMissingDeps: true,
  alwaysConfirmWrites: true,
  commandLogFile: ".rootx_command_log.jsonl",
  policyFileName: ".rootx_policy.json",
  allowedScripts: {
    npm: ["build", "lint", "test", "start", "dev", "rootx", "chat"],
    pnpm: ["build", "lint", "test", "start", "dev", "rootx", "chat"],
    yarn: ["build", "lint", "test", "start", "dev", "rootx", "chat"],
  },
  allowedNodeScripts: ["rootx.js", "chat.js", "test_all.js", "test_context_budget.js"],
  allowedPythonModules: ["pytest"],
  allowedGitReadOnly: ["status", "log", "diff", "branch", "rev-parse", "ls-files"],
  allowedGitWrite: ["add", "commit", "push", "pull", "checkout", "merge", "rebase"],
  blockedExecutables: ["rm", "del", "format", "shutdown", "reboot", "sudo", "curl", "wget"],
  allowedSystemTools: ["ls", "echo", "cat", "dir", "pwd", "tree", "type"],
  allowedPythonExecs: ["python", "python3", "py"],
};

function mergePolicy(base, override) {
  return {
    ...base,
    ...override,
    allowedScripts: {
      ...base.allowedScripts,
      ...(override.allowedScripts || {}),
    },
  };
}

export function loadProjectCommandPolicy(projectDir) {
  const policyPath = path.join(projectDir, DEFAULT_COMMAND_POLICY.policyFileName);
  if (!fs.existsSync(policyPath)) return DEFAULT_COMMAND_POLICY;

  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    return mergePolicy(DEFAULT_COMMAND_POLICY, parsed);
  } catch {
    return DEFAULT_COMMAND_POLICY;
  }
}

export default DEFAULT_COMMAND_POLICY;
