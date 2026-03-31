/**
 * Command Executor
 * Parsed, policy-aware command execution with preview, logging, and workspace checks.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import chalk from "chalk";
import readline from "readline";
import inquirer from "inquirer";
import { loadProjectCommandPolicy } from "../config/commandPolicy.js";

const BLOCKED_OPERATORS = ["&&", "||", ";", "|", ">", "<", "$(", "${", "`"];
const WINDOWS_SWITCH_COMMANDS = new Set(["dir"]);
const PACKAGE_MANAGER_FILES = {
  npm: ["package.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  pip: ["requirements.txt", "pyproject.toml"],
};



async function askBlockAction(command, reason) {
  console.log(chalk.red(`\n  BLOCKED  ${command}`));
  console.log(chalk.gray(`    Reason: ${reason}`));
  
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: chalk.yellow("This command was blocked. What would you like to do?"),
      choices: [
        { name: "Skip this command (Recommended)", value: "skip" },
        { name: "Run it anyway", value: "run_anyway" },
        { name: "Edit command before running", value: "edit" }
      ]
    }
  ]);

  if (action === "edit") {
    const { newCommand } = await inquirer.prompt([
      {
        type: "input",
        name: "newCommand",
        message: "Edit command:",
        default: command
      }
    ]);
    return { action: "run_edited", command: newCommand };
  }

  return { action, command };
}

function appendCommandLog(projectDir, policy, entry) {
  try {
    const logPath = path.join(projectDir, policy.commandLogFile);
    fs.appendFileSync(logPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    }) + "\n");
  } catch {} // command log write failure is non-critical
}

function parseCommandString(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];

    if (quote) {
      if (char === "\\" && index + 1 < command.length) {
        const nextChar = command[index + 1];
        if (nextChar === quote || nextChar === "\\") {
          current += nextChar;
          index++;
          continue;
        }
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unterminated quote in command");
  }
  if (current) parts.push(current);
  return parts;
}

function hasBlockedShellSyntax(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      if (char === "\\" && i + 1 < command.length) {
        const nextChar = command[i + 1];
        if (nextChar === quote || nextChar === "\\") {
          i++;
        }
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    for (const operator of BLOCKED_OPERATORS) {
      if (command.startsWith(operator, i)) {
        return true;
      }
    }
  }
  return false;
}

function isWithinWorkspace(projectDir, targetPath) {
  const relative = path.relative(projectDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isWindowsSwitchArg(executable, arg) {
  return process.platform === "win32"
    && WINDOWS_SWITCH_COMMANDS.has(executable)
    && /^\/[a-z?][\w:-]*$/i.test(arg);
}

function isOptionArg(executable, arg) {
  if (!arg) return false;
  if (arg === "--") return false;
  if (arg.startsWith("--")) return true;
  if (arg.startsWith("-") && arg !== "-") return true;
  return isWindowsSwitchArg(executable, arg);
}

function looksLikePathArg(executable, arg) {
  if (!arg || /^https?:\/\//i.test(arg) || isOptionArg(executable, arg)) return false;
  if (arg === "." || arg === "..") return true;
  if (/^[a-z]:[\\/]/i.test(arg)) return true;
  if (arg.startsWith("./") || arg.startsWith(".\\") || arg.startsWith("../") || arg.startsWith("..\\")) return true;
  if (path.posix.isAbsolute(arg)) return true;
  return arg.includes("/") || arg.includes("\\");
}

function getOutsideWorkspaceTargets(parsed, projectDir, policy) {
  if (policy.allowOutsideWorkspacePaths) return [];

  const outsideTargets = [];
  for (const arg of parsed.args) {
    if (!looksLikePathArg(parsed.executable.toLowerCase(), arg)) continue;
    const resolved = path.resolve(projectDir, arg);
    if (!isWithinWorkspace(projectDir, resolved)) {
      outsideTargets.push(resolved);
    }
  }

  return outsideTargets;
}

function existsAny(projectDir, fileNames) {
  return fileNames.some((fileName) => fs.existsSync(path.join(projectDir, fileName)));
}

export function classifyParsedCommand(parsed, projectDir, policy) {
  const [first, second, third] = parsed.tokens;
  const executable = first.toLowerCase();

  if (policy.blockedExecutables.includes(executable)) {
    return { allowed: false, intent: "destructive", mode: "blocked", reason: "Blocked executable" };
  }

  const outsideTargets = getOutsideWorkspaceTargets(parsed, projectDir, policy);
  if (outsideTargets.length > 0) {
    return {
      allowed: true,
      intent: "external_directory",
      mode: "confirm",
      reason: "Command accesses paths outside the workspace",
      targets: outsideTargets,
    };
  }

  if (executable === "npm" || executable === "pnpm" || executable === "yarn") {
    const scripts = policy.allowedScripts[executable] || [];
    if (second === "test" || second === "start") {
      return { allowed: true, intent: "build_test", mode: "auto", reason: "Allowed package manager command" };
    }
    if (second === "run" && scripts.includes(third)) {
      return { allowed: true, intent: "build_test", mode: "auto", reason: "Allowed package script" };
    }
    if (executable === "npm" && second === "install" && parsed.args.length === 0) {
      return {
        allowed: existsAny(projectDir, PACKAGE_MANAGER_FILES.npm),
        intent: "dependency_install",
        mode: "auto",
        reason: "Install project dependencies from package manifest",
      };
    }
    if (executable === "pnpm" && second === "install" && parsed.args.length === 0) {
      return {
        allowed: existsAny(projectDir, PACKAGE_MANAGER_FILES.pnpm),
        intent: "dependency_install",
        mode: "auto",
        reason: "Install project dependencies from pnpm manifest",
      };
    }
    if (executable === "yarn" && second === "install" && parsed.args.length === 0) {
      return {
        allowed: existsAny(projectDir, PACKAGE_MANAGER_FILES.yarn),
        intent: "dependency_install",
        mode: "auto",
        reason: "Install project dependencies from yarn manifest",
      };
    }
    if (
      (executable === "npm" && ["install", "uninstall"].includes(second)) ||
      (executable === "pnpm" && ["add", "remove"].includes(second)) ||
      (executable === "yarn" && ["add", "remove"].includes(second))
    ) {
      return { allowed: true, intent: "dependency_install", mode: "confirm", reason: "Dependency change command" };
    }
    return { allowed: false, intent: "unknown", mode: "blocked", reason: "Unapproved package manager command" };
  }

  if (executable === "git") {
    if (policy.allowedGitReadOnly.includes(second)) {
      return { allowed: true, intent: "read_only", mode: "auto", reason: "Read-only git command" };
    }
    if (policy.allowedGitWrite.includes(second)) {
      return { allowed: true, intent: "git_write", mode: "confirm", reason: "Git write command" };
    }
    return { allowed: false, intent: "unknown", mode: "blocked", reason: "Unapproved git command" };
  }

  if (executable === "node") {
    const target = path.basename(parsed.args[0] || "");
    if (policy.allowedNodeScripts.includes(target)) {
      return { allowed: true, intent: "local_script", mode: "auto", reason: "Approved local node script" };
    }
    return { allowed: true, intent: "local_script", mode: "confirm", reason: "Local node script requires confirmation" };
  }

  if (policy.allowedPythonExecs && policy.allowedPythonExecs.includes(executable)) {
    if (second === "-m" && policy.allowedPythonModules.includes(third)) {
      return { allowed: true, intent: "build_test", mode: "auto", reason: "Approved Python module execution" };
    }
    return { allowed: true, intent: "local_script", mode: "confirm", reason: "Python execution requires confirmation" };
  }

  if (policy.allowedSystemTools && policy.allowedSystemTools.includes(executable)) {
    return { allowed: true, intent: "read_only", mode: "auto", reason: "Approved system utility command" };
  }

  if (executable === "pip") {
    if (second === "install" && parsed.args[0] === "-r") {
      return {
        allowed: existsAny(projectDir, PACKAGE_MANAGER_FILES.pip),
        intent: "dependency_install",
        mode: "confirm",
        reason: "Install Python dependencies from requirements file",
      };
    }
    return { allowed: false, intent: "unknown", mode: "blocked", reason: "Unapproved pip command" };
  }

  if (executable === "mkdir") {
    return { allowed: true, intent: "file_write", mode: "confirm", reason: "Filesystem write command" };
  }

  return { allowed: false, intent: "unknown", mode: "blocked", reason: "Executable is not in the command policy" };
}

function previewCommand(rawCommand, classification, parsed) {
  console.log(chalk.cyan("\nCommand Preview"));
  console.log(chalk.gray("─".repeat(48)));
  console.log(chalk.white(`  Command: ${rawCommand}`));
  console.log(chalk.gray(`  Intent:  ${classification.intent}`));
  console.log(chalk.gray(`  Policy:  ${classification.mode}`));
  console.log(chalk.gray(`  Reason:  ${classification.reason}`));
  console.log(chalk.gray(`  Parsed:  ${parsed.executable}${parsed.args.length ? " " + parsed.args.join(" ") : ""}`));
}

function executeParsedCommand(parsed, projectDir, timeoutMs) {
  return spawnSync(parsed.executable, parsed.args, {
    cwd: projectDir,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: true,
    windowsHide: true,
  });
}

function summarizeOutput(result) {
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  return lines.slice(0, 10).join("\n");
}

function inferInstallCommand(errorText, projectDir) {
  if (!errorText) return null;
  const text = errorText.toLowerCase();

  const hasNpm = existsAny(projectDir, PACKAGE_MANAGER_FILES.npm);
  const hasPnpm = existsAny(projectDir, PACKAGE_MANAGER_FILES.pnpm);
  const hasYarn = existsAny(projectDir, PACKAGE_MANAGER_FILES.yarn);
  const hasPip = existsAny(projectDir, PACKAGE_MANAGER_FILES.pip);

  const installBase = hasPnpm ? "pnpm install" : hasYarn ? "yarn install" : hasNpm ? "npm install" : null;

  const winMatch = errorText.match(/'([^']+)' is not recognized as an internal or external command/i);
  if (winMatch && installBase) return installBase;

  const linuxMatch = errorText.match(/(?:bash:|sh:)?\s*(\S+):\s*command not found/i);
  if (linuxMatch && installBase) return installBase;

  if (text.includes("enoent") && text.includes("spawn") && installBase) {
    return installBase;
  }

  const modulePatterns = [
    /cannot find module ['"]([^'"]+)['"]/i,
    /module not found.*['"]([^'"]+)['"]/i,
    /error: cannot find package ['"]([^'"]+)['"]/i,
    /err_module_not_found.*['"]([^'"]+)['"]/i,
  ];

  for (const pattern of modulePatterns) {
    const match = errorText.match(pattern);
    if (!match) continue;
    let pkg = match[1];
    if (pkg.startsWith(".") || pkg.startsWith("/")) continue;
    if (pkg.startsWith("@") && pkg.includes("/")) {
      pkg = pkg.split("/").slice(0, 2).join("/");
    } else {
      pkg = pkg.split("/")[0];
    }
    if (hasPnpm) return `pnpm add ${pkg}`;
    if (hasYarn) return `yarn add ${pkg}`;
    if (hasNpm) return `npm install ${pkg}`;
  }

  const pyMatch = errorText.match(/No module named ['"]([^'"]+)['"]/i);
  if (pyMatch && hasPip) {
    return `pip install ${pyMatch[1]}`;
  }

  return null;
}

export function autoInstallFromError(errorText, projectDir = process.cwd()) {
  return inferInstallCommand(errorText, projectDir);
}

export function buildParsedCommand(rawCommand) {
  const tokens = parseCommandString(rawCommand);
  const [executable, ...args] = tokens;
  return { rawCommand, tokens, executable, args };
}



export async function runCommands(commands, projectDir, options = {}) {
  if (!commands || !Array.isArray(commands) || commands.length === 0) return;

  const policy = loadProjectCommandPolicy(projectDir);
  const source = options.source || "ai";
  const dryRun = options.dryRun ?? policy.dryRun;

  console.log(chalk.cyan("\nCommand Executor"));
  console.log(chalk.gray("─".repeat(48)));

  let executed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let logs = "";

  for (let i = 0; i < commands.length; i++) {
    const raw = commands[i];
    if (!raw || typeof raw !== "string") continue;
    let trimmed = raw.trim();

    // Re-evaluation loop for edits
    let isBlocked = false;
    let blockReason = "";
    
    // We check rules recursively if edited
    let checkPass = false;
    let parsed = null;
    let classification = null;

    while (!checkPass) {
      isBlocked = false;
      let needsConfirm = false;
      try {
        parsed = buildParsedCommand(trimmed);
        if (!parsed.executable) {
           checkPass = true; // empty command
           break;
        }
        classification = classifyParsedCommand(parsed, projectDir, policy);

        if (hasBlockedShellSyntax(trimmed)) {
          classification.intent = "shell_script";
          if (classification.allowed !== false) {
            classification.mode = "confirm";
            classification.reason = "Contains shell operators (&&, |, >) and requires explicit approval.";
          } else {
            classification.reason += " (Also contains shell operators)";
          }
        }

        if (!classification.allowed || classification.mode === "blocked") {
          isBlocked = true;
          blockReason = classification.reason;
          previewCommand(trimmed, classification, parsed);
        } else if (classification.mode === "confirm" && !dryRun) {
          needsConfirm = true;
          previewCommand(trimmed, classification, parsed);
        }
      } catch (error) {
        isBlocked = true;
        blockReason = `Parse error - ${error.message}`;
      }

      if (!isBlocked && !needsConfirm && parsed?.executable) {
        if (!classification) classification = classifyParsedCommand(parsed, projectDir, policy);
        previewCommand(trimmed, classification, parsed);
      }

      if (isBlocked) {
        const resolution = await askBlockAction(trimmed, blockReason);
        if (resolution.action === "skip") {
          console.log(chalk.gray("  Result: skipped by user"));
          logs += `${trimmed} (Blocked & Skipped): ${blockReason}\n\n`;
          appendCommandLog(projectDir, policy, { source, command: trimmed, outcome: "blocked", reason: blockReason });
          blocked++;
          checkPass = true; // break out of check loop
          parsed = null;    // avoid execution
        } else if (resolution.action === "run_anyway") {
          console.log(chalk.yellow("  Result: user forced run"));
          checkPass = true; // proceed to execution
          if (!parsed) {
             try { parsed = buildParsedCommand(trimmed); } catch(e) {} // re-parse after user edit may fail
          }
          if (!classification) {
             classification = { allowed: true, intent: "forced_by_user", mode: "auto", reason: "User override" };
          }
        } else if (resolution.action === "run_edited") {
          trimmed = resolution.command;
          console.log(chalk.cyan(`  Re-evaluating: ${trimmed}`));
          // Loops back to check the new trimmed command
        }
      } else if (needsConfirm) {
        const { action } = await inquirer.prompt([{
          type: "list",
          name: "action",
          message: chalk.yellow(`Confirm ${classification.intent} command?`),
          choices: [
            { name: "Yes, run it", value: "run" },
            { name: "No, skip it", value: "skip" },
            { name: "Edit command", value: "edit" }
          ]
        }]);

        if (action === "skip") {
          console.log(chalk.gray("  Result: skipped by user"));
          logs += `${trimmed} (Skipped): User declined permission to run this command.\n\n`;
          appendCommandLog(projectDir, policy, { source, command: trimmed, parsed: parsed.tokens, outcome: "skipped", reason: "user_declined", intent: classification.intent });
          skipped++;
          checkPass = true;
          parsed = null;
        } else if (action === "run") {
          checkPass = true;
        } else if (action === "edit") {
          const { newCommand } = await inquirer.prompt([{
            type: "input",
            name: "newCommand",
            message: "Edit command:",
            default: trimmed
          }]);
          trimmed = newCommand;
          console.log(chalk.cyan(`  Re-evaluating: ${trimmed}`));
        }
      } else {
        checkPass = true;
      }
    }

    if (!parsed || !parsed.executable) {
       continue;
    }

    if (!isBlocked && dryRun && classification.mode === "confirm") {
      console.log(chalk.yellow("  Result: dry-run only"));
      appendCommandLog(projectDir, policy, { source, command: trimmed, parsed: parsed.tokens, outcome: "dry_run", intent: classification.intent });
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(chalk.yellow("  Result: dry-run only"));
      appendCommandLog(projectDir, policy, { source, command: trimmed, parsed: parsed.tokens, outcome: "dry_run", intent: classification.intent });
      skipped++;
      continue;
    }

    const result = executeParsedCommand(parsed, projectDir, policy.commandTimeoutMs);
    const outputPreview = summarizeOutput(result);

    if (result.status === 0) {
      if (outputPreview) {
        console.log(chalk.gray(outputPreview));
        logs += `${trimmed} (Success):\n${outputPreview}\n\n`;
      } else {
        logs += `${trimmed} (Success)\n\n`;
      }
      console.log(chalk.green("  Result: success"));
      appendCommandLog(projectDir, policy, {
        source,
        command: trimmed,
        parsed: parsed.tokens,
        outcome: "success",
        intent: classification.intent,
        status: result.status,
      });
      executed++;
      continue;
    }

    failed++;
    const combinedError = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
    console.log(chalk.red("  Result: failed"));
    if (outputPreview) console.log(chalk.gray(outputPreview));
    logs += `${trimmed} (Failed with status ${result.status}):\n${combinedError}\n\n`;
    appendCommandLog(projectDir, policy, {
      source,
      command: trimmed,
      parsed: parsed.tokens,
      outcome: "failed",
      intent: classification.intent,
      status: result.status,
      error: combinedError.slice(0, 1000),
    });

    if (policy.autoInstallMissingDeps && source !== "auto_install") {
      const installCommand = inferInstallCommand(combinedError, projectDir);
      if (installCommand) {
        console.log(chalk.yellow(`  Auto-fix candidate: ${installCommand}`));
        const installResult = await runCommands([installCommand], projectDir, {
          ...options,
          source: "auto_install",
          dryRun,
        });
        if (installResult?.executed > 0 && !dryRun) {
          const retryResult = executeParsedCommand(parsed, projectDir, policy.commandTimeoutMs);
          const retryPreview = summarizeOutput(retryResult);
          if (retryResult.status === 0) {
            if (retryPreview) console.log(chalk.gray(retryPreview));
            console.log(chalk.green("  Retry: success"));
            appendCommandLog(projectDir, policy, {
              source,
              command: trimmed,
              parsed: parsed.tokens,
              outcome: "retry_success",
              intent: classification.intent,
              status: retryResult.status,
            });
            executed++;
            failed--;
          } else {
            console.log(chalk.red("  Retry: failed"));
          }
        }
      }
    }
  }

  console.log(chalk.gray("─".repeat(48)));
  console.log(`  Results: ${executed} executed, ${failed} failed, ${blocked} blocked, ${skipped} skipped`);
  return { executed, failed, blocked, skipped, logs: logs.trim() };
}

export default runCommands;
