/**
 * engine/patchEngine.js — Surgical file editing with fuzzy matching
 */

import fs from "fs";
import path from "path";
import { createPatch } from "diff";

function emitReporter(reporter, method, payload) {
  if (reporter && typeof reporter[method] === "function") {
    reporter[method](payload);
  }
}

function logWithOptions(options, ...args) {
  if (!options?.silent) {
    console.log(...args);
  }
}

function summarizePatch(patchText) {
  const lines = String(patchText || "").split("\n");
  let additions = 0;
  let removals = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) removals++;
  }

  return { additions, removals };
}

function buildDiffPreviewFromPatch(patchText, maxLines = 16) {
  const lines = String(patchText || "").split("\n");
  const preview = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
      }
      continue;
    }

    if (!inHunk || line.startsWith("\\") || line.startsWith("diff --git") || line.startsWith("Index:")) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      preview.push({ type: "added", lineNum: String(newLine), text: line });
      newLine++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      preview.push({ type: "removed", lineNum: String(oldLine), text: line });
      oldLine++;
      continue;
    }

    if (line.startsWith(" ")) {
      preview.push({ type: "context", lineNum: String(newLine), text: line });
      oldLine++;
      newLine++;
    }
  }

  if (preview.length <= maxLines) return preview;

  const clipped = preview.slice(0, maxLines);
  const hiddenCount = preview.length - maxLines;
  clipped.push({
    type: "context",
    lineNum: "",
    text: `... ${hiddenCount} more diff line${hiddenCount === 1 ? "" : "s"}`,
  });
  return clipped;
}

function similarity(a, b) {
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  if (la > 5000 || lb > 5000) {
    const aLines = a.split("\n").map(l => l.trim()).filter(Boolean);
    const bLines = b.split("\n").map(l => l.trim()).filter(Boolean);
    let matches = 0;
    for (const line of aLines) {
      if (bLines.includes(line)) matches++;
    }
    return matches / Math.max(aLines.length, bLines.length);
  }
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[la][lb] / Math.max(la, lb);
}

function fuzzyFindAndReplace(fileContent, search, replace, onFuzzyMatch = null) {
  // Exact match first
  const idx = fileContent.indexOf(search);
  if (idx !== -1) {
    return fileContent.slice(0, idx) + replace + fileContent.slice(idx + search.length);
  }

  // Trimmed-whitespace match: normalize leading whitespace
  const searchLines = search.split("\n").map(l => l.trimEnd());
  const fileLines = fileContent.split("\n");
  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (fileLines[i + j].trimEnd() !== searchLines[j]) { match = false; break; }
    }
    if (match) {
      const before = fileLines.slice(0, i);
      const after = fileLines.slice(i + searchLines.length);
      return [...before, replace, ...after].join("\n");
    }
  }

  // Fuzzy sliding window match (similarity > 0.8)
  const searchNorm = search.trim();
  const windowSize = searchLines.length;
  let bestScore = 0, bestIdx = -1;
  for (let i = 0; i <= fileLines.length - windowSize; i++) {
    const window = fileLines.slice(i, i + windowSize).join("\n").trim();
    const score = similarity(searchNorm, window);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestScore >= 0.8 && bestIdx >= 0) {
    const before = fileLines.slice(0, bestIdx);
    const after = fileLines.slice(bestIdx + windowSize);
    if (typeof onFuzzyMatch === "function") {
      onFuzzyMatch(bestScore);
    }
    return [...before, replace, ...after].join("\n");
  }

  return null; // No match found
}

export function patchFile(projectDir, filePath, newContent, edits = null, options = {}) {
  const reporter = options.reporter || null;

  // Sanitize path — strictly strip all leading slashes before resolving.
  const cleanPath = filePath.replace(/^(\/|\\)+/, "");
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.resolve(projectDir, normalized);
  const relativeToProject = path.relative(path.resolve(projectDir), fullPath);
  
  // Security: ensure the file stays within the project directory
  if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    emitReporter(reporter, "fileChange", {
      path: normalized,
      action: "blocked",
      status: "error",
      detail: "Path traversal denied",
    });
    logWithOptions(options, "❌ Blocked:", filePath, "(path escape attempt)");
    throw new Error(`Security Exception: Path traversal denied for ${filePath}`);
  }

  try {
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // === SURGICAL EDIT MODE (search/replace) ===
    if (edits && Array.isArray(edits) && edits.length > 0) {
      if (!fs.existsSync(fullPath)) {
        emitReporter(reporter, "fileChange", {
          path: normalized,
          action: "edit",
          status: "error",
          detail: "File does not exist",
        });
        logWithOptions(options, "  ❌ Cannot edit (file doesn't exist):", normalized);
        return;
      }
      const originalContent = fs.readFileSync(fullPath, "utf8");
      let content = originalContent;
      let applied = 0, failed = 0;

      for (const edit of edits) {
        if (!edit.search || typeof edit.replace !== "string") {
          logWithOptions(options, "    ⚠️  Skipped invalid edit (missing search/replace)");
          failed++;
          continue;
        }
        const result = fuzzyFindAndReplace(content, edit.search, edit.replace, (score) => {
          emitReporter(reporter, "log", {
            level: "info",
            message: `Fuzzy matched ${normalized} at ${(score * 100).toFixed(0)}% similarity`,
          });
          logWithOptions(options, `    ↳ Fuzzy matched (${(score * 100).toFixed(0)}% similar)`);
        });
        if (result !== null) {
          content = result;
          applied++;
        } else {
          logWithOptions(options, `    ⚠️  Could not find match for search block (${edit.search.split("\n").length} lines)`);
          failed++;
        }
      }

      fs.writeFileSync(fullPath, content, "utf8");
      const patch = createPatch(normalized, originalContent, content, "", "", { context: 2 });
      const { additions, removals } = summarizePatch(patch);
      emitReporter(reporter, "fileChange", {
        path: normalized,
        action: "edit",
        status: failed > 0 ? "warning" : "success",
        applied,
        failed,
        additions,
        removals,
        diffPreview: buildDiffPreviewFromPatch(patch),
      });
      logWithOptions(options, `  🔧 Surgical edit: ${normalized} (${applied} applied, ${failed} failed)`);
      return;
    }

    // === FULL OVERWRITE MODE (backward-compatible) ===
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, newContent, "utf8");
      const patch = createPatch(normalized, "", newContent, "", "", { context: 2 });
      const { additions, removals } = summarizePatch(patch);
      emitReporter(reporter, "fileChange", {
        path: normalized,
        action: "create",
        status: "success",
        additions,
        removals,
        diffPreview: buildDiffPreviewFromPatch(patch),
      });
      logWithOptions(options, "  📄 Created:", normalized);
      return;
    }

    const oldContent = fs.readFileSync(fullPath, "utf8");
    if (oldContent === newContent) {
      emitReporter(reporter, "fileChange", {
        path: normalized,
        action: "noop",
        status: "info",
      });
      logWithOptions(options, "  ✓ No change:", normalized);
      return;
    }

    const patch = createPatch(normalized, oldContent, newContent, "", "", { context: 2 });
    const { additions, removals } = summarizePatch(patch);
    fs.writeFileSync(fullPath, newContent, "utf8");
    emitReporter(reporter, "fileChange", {
      path: normalized,
      action: "patch",
      status: "success",
      diffBytes: patch.length,
      additions,
      removals,
      diffPreview: buildDiffPreviewFromPatch(patch),
    });
    logWithOptions(options, "  🛠 Patched:", normalized);
  } catch (e) {
    emitReporter(reporter, "fileChange", {
      path: normalized,
      action: edits ? "edit" : "write",
      status: "error",
      detail: e.message,
    });
    logWithOptions(options, "  ❌ Failed to write:", normalized, "—", e.message);
  }
}
