import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import chalk from "chalk";

function runGit(args, cwd) {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function quotePath(filePath) {
  return `"${String(filePath).replace(/"/g, '\\"')}"`;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
}

function parseStatusLine(line) {
  if (!line) return null;
  const statusCode = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  if (!rawPath) return null;

  if (rawPath.includes(" -> ")) {
    const [, nextPath] = rawPath.split(" -> ");
    return { path: nextPath.trim(), statusCode };
  }

  return { path: rawPath, statusCode };
}

function listChangedPaths(repoDir) {
  const output = runGit("status --porcelain -uall", repoDir);
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map(parseStatusLine)
    .filter(Boolean);
}

function copyIntoSnapshot(repoDir, snapshotDir, relativePath) {
  const sourcePath = path.join(repoDir, relativePath);
  const destPath = path.join(snapshotDir, relativePath);

  if (!fs.existsSync(sourcePath)) {
    return { path: relativePath, exists: false };
  }

  ensureParentDir(destPath);
  fs.copyFileSync(sourcePath, destPath);
  return { path: relativePath, exists: true };
}

function isTracked(repoDir, relativePath) {
  try {
    runGit(`ls-files --error-unmatch -- ${quotePath(relativePath)}`, repoDir);
    return true;
  } catch {
    return false;
  }
}

function restoreTrackedFileFromHead(repoDir, relativePath) {
  execSync(`git checkout -- ${quotePath(relativePath)}`, {
    cwd: repoDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function gitCheckpoint(repoDir = process.cwd()) {
  try {
    runGit("rev-parse --is-inside-work-tree", repoDir);
  } catch {
    return null;
  }

  try {
    const changedPaths = listChangedPaths(repoDir);
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "devai-checkpoint-"));
    const entries = changedPaths.map(({ path: relativePath }) =>
      copyIntoSnapshot(repoDir, snapshotDir, relativePath)
    );

    return {
      type: changedPaths.length > 0 ? "snapshot" : "clean",
      repoDir,
      snapshotDir,
      entries,
    };
  } catch (e) {
    console.log(chalk.yellow("Warning: Git checkpoint failed: " + e.message));
    return null;
  }
}

export function gitRestore(checkpoint) {
  if (!checkpoint?.repoDir) return;

  try {
    console.log(chalk.gray(" Restoring previous workspace state..."));

    const entryMap = new Map((checkpoint.entries || []).map((entry) => [entry.path, entry]));
    const currentPaths = listChangedPaths(checkpoint.repoDir).map((entry) => entry.path);
    const targetPaths = new Set([...currentPaths, ...entryMap.keys()]);

    for (const relativePath of targetPaths) {
      const repoPath = path.join(checkpoint.repoDir, relativePath);
      const snapshotEntry = entryMap.get(relativePath);

      if (snapshotEntry) {
        if (snapshotEntry.exists) {
          const snapshotPath = path.join(checkpoint.snapshotDir, relativePath);
          ensureParentDir(repoPath);
          fs.copyFileSync(snapshotPath, repoPath);
        } else {
          removePath(repoPath);
        }
        continue;
      }

      if (isTracked(checkpoint.repoDir, relativePath)) {
        restoreTrackedFileFromHead(checkpoint.repoDir, relativePath);
      } else {
        removePath(repoPath);
      }
    }

    console.log(chalk.green(" Workspace rollback complete."));
  } catch (e) {
    console.log(chalk.red("Rollback failed: " + e.message));
  } finally {
    gitDiscard(checkpoint);
  }
}

export function gitDiscard(checkpoint) {
  if (!checkpoint?.snapshotDir) return;
  try {
    fs.rmSync(checkpoint.snapshotDir, { recursive: true, force: true });
  } catch {} // snapshot may already be cleaned up
}
