import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { discoverInstructionDocs } from "./instructions.js";

function readGitOutput(cwd, args) {
  try {
    const output = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    if (output.status !== 0) return null;
    return output.stdout || "";
  } catch {
    return null;
  }
}

export function readGitStatus(cwd) {
  const stdout = readGitOutput(cwd, ["--no-optional-locks", "status", "--short", "--branch"]);
  const trimmed = String(stdout || "").trim();
  return trimmed || null;
}

function trimDiffToBudget(diff, maxChars) {
  const value = String(diff || "").trimEnd();
  if (!value) return null;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

export function readGitDiff(cwd, maxChars = 6000) {
  const sections = [];
  const staged = readGitOutput(cwd, ["diff", "--cached"]);
  if (staged && staged.trim()) {
    sections.push(`Staged changes:\n${staged.trimEnd()}`);
  }

  const unstaged = readGitOutput(cwd, ["diff"]);
  if (unstaged && unstaged.trim()) {
    sections.push(`Unstaged changes:\n${unstaged.trimEnd()}`);
  }

  if (!sections.length) return null;
  return trimDiffToBudget(sections.join("\n\n"), maxChars);
}

export function detectModelFamily(modelConfig = {}) {
  return (
    modelConfig.family ||
    modelConfig.name ||
    modelConfig.id ||
    modelConfig.model ||
    "unknown"
  );
}

export function buildProjectContext(cwd = process.cwd(), options = {}) {
  const resolvedCwd = path.resolve(cwd);
  const currentDate = options.currentDate || new Date().toISOString().slice(0, 10);
  const instructionFiles = options.instructionFiles || discoverInstructionDocs(resolvedCwd, options);

  return {
    cwd: resolvedCwd,
    currentDate,
    osName: options.osName || os.platform(),
    osVersion: options.osVersion || os.release(),
    modelFamily: options.modelFamily || detectModelFamily(options.modelConfig),
    instructionFiles,
    gitStatus: options.includeGit === false ? null : readGitStatus(resolvedCwd),
    gitDiff: options.includeGit === false ? null : readGitDiff(resolvedCwd, options.maxGitDiffChars || 6000),
  };
}

export function renderProjectContext(projectContext) {
  const lines = ["# Project context"];
  const bullets = [
    `Today's date is ${projectContext.currentDate}.`,
    `Working directory: ${projectContext.cwd}`,
  ];

  if (Array.isArray(projectContext.instructionFiles) && projectContext.instructionFiles.length > 0) {
    bullets.push(`Claw instruction files discovered: ${projectContext.instructionFiles.length}.`);
  }

  lines.push(...bullets.map((item) => ` - ${item}`));

  if (projectContext.gitStatus) {
    lines.push("");
    lines.push("Git status snapshot:");
    lines.push(projectContext.gitStatus);
  }

  if (projectContext.gitDiff) {
    lines.push("");
    lines.push("Git diff snapshot:");
    lines.push(projectContext.gitDiff);
  }

  return lines.join("\n");
}
