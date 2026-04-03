import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  MAX_INSTRUCTION_FILE_CHARS,
  MAX_TOTAL_INSTRUCTION_CHARS,
} from "./sections.js";

const CLAW_INSTRUCTION_FILES = [
  { relativePath: "CLAW.md", kind: "claw" },
  { relativePath: "CLAW.local.md", kind: "claw" },
  { relativePath: path.join(".claw", "CLAW.md"), kind: "claw" },
  { relativePath: path.join(".claw", "instructions.md"), kind: "claw" },
];

const COMPAT_INSTRUCTION_FILES = [
  { relativePath: "AGENTS.md", kind: "compatibility" },
  { relativePath: "CLAUDE.md", kind: "compatibility" },
];

const GLOBAL_COMPAT_DIR = path.join(os.homedir(), ".config", "kilo");

export function collapseBlankLines(content = "") {
  const lines = String(content).split(/\r?\n/);
  const next = [];
  let previousBlank = false;

  for (const line of lines) {
    const trimmed = line.replace(/\s+$/g, "");
    const isBlank = trimmed.trim().length === 0;
    if (isBlank && previousBlank) continue;
    next.push(trimmed);
    previousBlank = isBlank;
  }

  return next.join("\n");
}

export function normalizeInstructionContent(content = "") {
  return collapseBlankLines(content).trim();
}

export function stableContentHash(content = "") {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function safeReadFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function getAncestorDirectories(cwd) {
  const directories = [];
  let cursor = path.resolve(cwd);

  while (cursor) {
    directories.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  return directories.reverse();
}

function pushInstructionDoc(collection, filePath, metadata) {
  const content = safeReadFile(filePath);
  if (!content) return;

  collection.push({
    path: filePath,
    content,
    source: metadata.source,
    scope: metadata.scope,
    kind: metadata.kind,
    label: path.basename(filePath),
  });
}

export function dedupeInstructionDocs(files = []) {
  const seen = new Set();
  const deduped = [];

  for (const file of files) {
    const normalized = normalizeInstructionContent(file.content);
    if (!normalized) continue;
    const hash = stableContentHash(normalized);
    if (seen.has(hash)) continue;
    seen.add(hash);
    deduped.push({ ...file, normalizedContent: normalized });
  }

  return deduped;
}

export function discoverInstructionDocs(cwd = process.cwd(), options = {}) {
  const includeCompatibility = options.includeCompatibility !== false;
  const directories = getAncestorDirectories(cwd);
  const files = [];

  if (includeCompatibility) {
    for (const candidate of COMPAT_INSTRUCTION_FILES) {
      pushInstructionDoc(files, path.join(GLOBAL_COMPAT_DIR, candidate.relativePath), {
        source: "global",
        scope: GLOBAL_COMPAT_DIR,
        kind: candidate.kind,
      });
    }
  }

  for (const dir of directories) {
    for (const candidate of CLAW_INSTRUCTION_FILES) {
      pushInstructionDoc(files, path.join(dir, candidate.relativePath), {
        source: "workspace",
        scope: dir,
        kind: candidate.kind,
      });
    }

    if (includeCompatibility) {
      for (const candidate of COMPAT_INSTRUCTION_FILES) {
        pushInstructionDoc(files, path.join(dir, candidate.relativePath), {
          source: "workspace",
          scope: dir,
          kind: candidate.kind,
        });
      }
    }
  }

  return dedupeInstructionDocs(files);
}

export function displayContextPath(filePath) {
  return path.basename(filePath);
}

export function describeInstructionDoc(file) {
  return `${displayContextPath(file.path)} (scope: ${file.scope})`;
}

export function truncateInstructionContent(content = "", remainingChars = MAX_TOTAL_INSTRUCTION_CHARS) {
  const hardLimit = Math.min(MAX_INSTRUCTION_FILE_CHARS, Math.max(0, remainingChars));
  const trimmed = String(content).trim();
  if (trimmed.length <= hardLimit) return trimmed;
  return `${trimmed.slice(0, hardLimit)}\n\n[truncated]`;
}

export function renderInstructionFiles(files = []) {
  if (!files.length) return "";

  const sections = ["# Claw instructions"];
  let remainingChars = MAX_TOTAL_INSTRUCTION_CHARS;

  for (const file of files) {
    if (remainingChars <= 0) {
      sections.push("_Additional instruction content omitted after reaching the prompt budget._");
      break;
    }

    const rendered = truncateInstructionContent(file.normalizedContent || file.content, remainingChars);
    remainingChars = Math.max(0, remainingChars - rendered.length);
    sections.push(`## ${describeInstructionDoc(file)}`);
    sections.push(rendered);
  }

  return sections.join("\n\n");
}
