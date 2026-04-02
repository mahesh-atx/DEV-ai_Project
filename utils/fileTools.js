import fs from "fs";
import path from "path";

const DEFAULT_SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".devai_memory.json",
  "_devai_last_response.txt",
]);

const MAX_RESULTS = 50;
const MAX_FILE_BYTES = 200000;

function isWithinRoot(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspacePath(projectDir, inputPath = ".") {
  const cleanPath = String(inputPath || ".").replace(/\\/g, "/");
  const resolved = path.resolve(projectDir, cleanPath);
  if (!isWithinRoot(projectDir, resolved)) {
    throw new Error(`Path traversal denied for ${inputPath}`);
  }
  return resolved;
}

function shouldSkipEntry(name, includeHidden = false) {
  if (DEFAULT_SKIP_NAMES.has(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

function globToRegExp(pattern) {
  let source = "^";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      i++;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }

  source += "$";
  return new RegExp(source, "i");
}

function parseContentQuery(query) {
  if (query.startsWith("/") && query.lastIndexOf("/") > 0) {
    const lastSlash = query.lastIndexOf("/");
    const body = query.slice(1, lastSlash);
    const flags = query.slice(lastSlash + 1);
    return { matcher: new RegExp(body, flags || "i"), type: "regex" };
  }

  return { matcher: query, type: "text" };
}

function matchesPathPattern(relPath, pattern) {
  const normalizedPath = relPath.replace(/\\/g, "/");
  const baseName = path.basename(normalizedPath.replace(/\/$/, ""));
  const normalizedPattern = pattern.replace(/\\/g, "/").trim();
  const lowerPattern = normalizedPattern.toLowerCase();

  if (!lowerPattern) return false;

  if (/[*?]/.test(normalizedPattern)) {
    const regex = globToRegExp(normalizedPattern);
    return regex.test(normalizedPath) || regex.test(baseName);
  }

  return normalizedPath.toLowerCase().includes(lowerPattern) || baseName.toLowerCase().includes(lowerPattern);
}

function pushResult(results, value) {
  if (!value || results.length >= MAX_RESULTS) return;
  if (!results.includes(value)) results.push(value);
}

export function listWorkspaceEntries(projectDir, inputPath = ".", options = {}) {
  const includeHidden = options.includeHidden === true;
  const maxDepth = Number.isInteger(options.depth) ? Math.max(0, options.depth) : 2;
  const startPath = resolveWorkspacePath(projectDir, inputPath);
  const results = [];

  function walk(currentPath, currentDepth) {
    if (results.length >= MAX_RESULTS) return;

    let stat;
    try {
      stat = fs.statSync(currentPath);
    } catch {
      return;
    }

    const relative = path.relative(projectDir, currentPath).replace(/\\/g, "/") || ".";
    if (currentPath !== startPath || stat.isFile()) {
      pushResult(results, stat.isDirectory() ? `${relative}/` : relative);
    }

    if (!stat.isDirectory() || currentDepth >= maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (shouldSkipEntry(entry.name, includeHidden)) continue;
      walk(path.join(currentPath, entry.name), currentDepth + 1);
      if (results.length >= MAX_RESULTS) return;
    }
  }

  walk(startPath, 0);
  return results;
}

export function searchWorkspaceFiles(projectDir, pattern, options = {}) {
  const includeHidden = options.includeHidden === true;
  const maxDepth = Number.isInteger(options.depth) ? Math.max(0, options.depth) : 8;
  const startPath = resolveWorkspacePath(projectDir, options.path || ".");
  const results = [];

  function walk(currentPath, currentDepth) {
    if (results.length >= MAX_RESULTS || currentDepth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (shouldSkipEntry(entry.name, includeHidden)) continue;

      const fullPath = path.join(currentPath, entry.name);
      const relative = path.relative(projectDir, fullPath).replace(/\\/g, "/");
      const displayPath = entry.isDirectory() ? `${relative}/` : relative;

      if (matchesPathPattern(displayPath, pattern)) {
        pushResult(results, displayPath);
      }

      if (entry.isDirectory()) {
        walk(fullPath, currentDepth + 1);
      }

      if (results.length >= MAX_RESULTS) return;
    }
  }

  walk(startPath, 0);
  return results;
}

export function searchWorkspaceContent(projectDir, query, options = {}) {
  const includeHidden = options.includeHidden === true;
  const maxDepth = Number.isInteger(options.depth) ? Math.max(0, options.depth) : 8;
  const startPath = resolveWorkspacePath(projectDir, options.path || ".");
  const includePattern = options.include ? String(options.include) : null;
  const parsed = parseContentQuery(query);
  const results = [];

  function lineMatches(line) {
    if (parsed.type === "regex") return parsed.matcher.test(line);
    return line.includes(parsed.matcher);
  }

  function walk(currentPath, currentDepth) {
    if (results.length >= MAX_RESULTS || currentDepth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (shouldSkipEntry(entry.name, includeHidden)) continue;

      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, currentDepth + 1);
        if (results.length >= MAX_RESULTS) return;
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) continue;

      const relative = path.relative(projectDir, fullPath).replace(/\\/g, "/");
      if (includePattern && !matchesPathPattern(relative, includePattern)) continue;

      let content;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);

      for (let index = 0; index < lines.length; index++) {
        if (!lineMatches(lines[index])) continue;
        pushResult(results, `${relative}:${index + 1}: ${lines[index].trim().slice(0, 120)}`);
        if (results.length >= MAX_RESULTS) return;
      }
    }
  }

  walk(startPath, 0);
  return results;
}
