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

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rs", ".java", ".go", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".cs", ".php", ".rb", ".swift", ".kt", ".kts", ".scala", ".sh",
  ".json", ".yaml", ".yml", ".toml", ".md",
]);

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

function shouldSkipEntry(name) {
  return DEFAULT_SKIP_NAMES.has(name) || name.startsWith(".");
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkWorkspaceFiles(projectDir, startPath = ".", maxResults = 250) {
  const root = resolveWorkspacePath(projectDir, startPath);
  const files = [];

  function walk(currentPath) {
    if (files.length >= maxResults) return;

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (isCodeFile(fullPath)) {
        files.push(fullPath);
      }

      if (files.length >= maxResults) return;
    }
  }

  walk(root);
  return files;
}

function readWorkspaceFile(projectDir, filePath) {
  const resolved = resolveWorkspacePath(projectDir, filePath);
  return {
    resolved,
    relative: path.relative(projectDir, resolved).replace(/\\/g, "/"),
    content: fs.readFileSync(resolved, "utf8"),
  };
}

function getLine(lines, lineNumber) {
  const safeIndex = Math.max(0, Math.min(lines.length - 1, (lineNumber || 1) - 1));
  return { index: safeIndex, text: lines[safeIndex] || "" };
}

function getWordAtPosition(content, lineNumber = 1, character = 1) {
  const lines = String(content || "").split(/\r?\n/);
  const { text } = getLine(lines, lineNumber);
  if (!text) return "";

  const cursor = Math.max(0, Math.min(text.length, (character || 1) - 1));
  const isWord = (char) => /[A-Za-z0-9_$]/.test(char);
  let start = cursor;
  let end = cursor;

  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;

  return text.slice(start, end).trim();
}

function extractDocumentSymbols(content) {
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "class", regex: /^\s*export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "function", regex: /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "function", regex: /^\s*export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "function", regex: /^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/ },
    { kind: "function", regex: /^\s*(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?[A-Za-z_][A-Za-z0-9_]*\s*=>/ },
    { kind: "function", regex: /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "class", regex: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:|$)/ },
    { kind: "function", regex: /^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "struct", regex: /^\s*struct\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "enum", regex: /^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)/ },
    { kind: "trait", regex: /^\s*trait\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  ];

  const symbols = [];

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        const name = match[1];
        symbols.push({
          name,
          kind: pattern.kind,
          line: index + 1,
          character: Math.max(1, line.indexOf(name) + 1),
        });
        break;
      }
    }
  });

  return symbols;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findReferences(projectDir, symbol, startPath = ".", maxResults = 100) {
  if (!symbol) return [];

  const regex = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
  const matches = [];
  const files = walkWorkspaceFiles(projectDir, startPath, 250);

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const relative = path.relative(projectDir, filePath).replace(/\\/g, "/");
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      if (!regex.test(lines[index])) continue;
      matches.push(`${relative}:${index + 1}: ${lines[index].trim()}`);
      if (matches.length >= maxResults) return matches;
    }
  }

  return matches;
}

function findOutgoingCalls(content, lineNumber = 1) {
  const lines = String(content || "").split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1);
  const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const reserved = new Set(["if", "for", "while", "switch", "return", "catch", "function", "class", "def", "fn"]);
  const calls = [];

  for (const line of lines.slice(start, Math.min(lines.length, start + 25))) {
    let match;
    while ((match = callRegex.exec(line)) !== null) {
      if (!reserved.has(match[1])) calls.push(match[1]);
    }
  }

  return [...new Set(calls)];
}

function formatSymbols(relativePath, symbols) {
  if (symbols.length === 0) return "No symbols found.";
  return symbols.map((symbol) => `${relativePath}:${symbol.line}:${symbol.character} ${symbol.kind} ${symbol.name}`).join("\n");
}

export async function runWorkspaceLsp(projectDir, options = {}) {
  const operation = options.operation;
  const filePath = options.filePath;
  const line = Number(options.line || 1);
  const character = Number(options.character || 1);

  if (!operation) return "Error: LSP operation is required.";
  if (!filePath) return "Error: filePath is required for LSP operations.";

  let file;
  try {
    file = readWorkspaceFile(projectDir, filePath);
  } catch (error) {
    return `Error: ${error.message}`;
  }

  const lines = file.content.split(/\r?\n/);
  const symbolAtCursor = getWordAtPosition(file.content, line, character);

  if (operation === "documentSymbol") {
    return formatSymbols(file.relative, extractDocumentSymbols(file.content));
  }

  if (operation === "workspaceSymbol") {
    const query = symbolAtCursor || path.basename(file.relative, path.extname(file.relative));
    const files = walkWorkspaceFiles(projectDir, ".", 250);
    const results = [];

    for (const candidatePath of files) {
      let content;
      try {
        content = fs.readFileSync(candidatePath, "utf8");
      } catch {
        continue;
      }

      const relative = path.relative(projectDir, candidatePath).replace(/\\/g, "/");
      const symbols = extractDocumentSymbols(content).filter((symbol) => symbol.name.toLowerCase().includes(query.toLowerCase()));

      for (const symbol of symbols) {
        results.push(`${relative}:${symbol.line}:${symbol.character} ${symbol.kind} ${symbol.name}`);
        if (results.length >= 100) break;
      }

      if (results.length >= 100) break;
    }

    return results.length > 0 ? results.join("\n") : `No workspace symbols found for ${query}.`;
  }

  if (operation === "hover") {
    const currentLine = getLine(lines, line).text.trim();
    return currentLine ? `${file.relative}:${line}:${character}\n${currentLine}` : "No hover information available at that position.";
  }

  if (operation === "goToDefinition" || operation === "goToImplementation" || operation === "prepareCallHierarchy") {
    if (!symbolAtCursor) return "No symbol found at that position.";

    const files = walkWorkspaceFiles(projectDir, ".", 250);
    const results = [];

    for (const candidatePath of files) {
      let content;
      try {
        content = fs.readFileSync(candidatePath, "utf8");
      } catch {
        continue;
      }

      const relative = path.relative(projectDir, candidatePath).replace(/\\/g, "/");
      const matches = extractDocumentSymbols(content).filter((symbol) => symbol.name === symbolAtCursor);
      for (const symbol of matches) {
        results.push(`${relative}:${symbol.line}:${symbol.character} ${symbol.kind} ${symbol.name}`);
      }
      if (results.length >= 25) break;
    }

    return results.length > 0 ? results.join("\n") : `No definition found for ${symbolAtCursor}.`;
  }

  if (operation === "findReferences" || operation === "incomingCalls") {
    if (!symbolAtCursor) return "No symbol found at that position.";
    const references = findReferences(projectDir, symbolAtCursor, ".", 100);
    return references.length > 0 ? references.join("\n") : `No references found for ${symbolAtCursor}.`;
  }

  if (operation === "outgoingCalls") {
    const outgoing = findOutgoingCalls(file.content, line);
    return outgoing.length > 0 ? outgoing.join("\n") : "No outgoing calls found near that position.";
  }

  return `Error: Unsupported LSP operation ${operation}.`;
}
