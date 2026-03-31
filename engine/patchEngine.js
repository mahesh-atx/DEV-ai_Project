/**
 * engine/patchEngine.js — Surgical file editing with fuzzy matching
 */

import fs from "fs";
import path from "path";
import { createPatch } from "diff";

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

function fuzzyFindAndReplace(fileContent, search, replace) {
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
    console.log(`    ↳ Fuzzy matched (${(bestScore * 100).toFixed(0)}% similar)`);
    return [...before, replace, ...after].join("\n");
  }

  return null; // No match found
}

export function patchFile(projectDir, filePath, newContent, edits = null) {
  // Sanitize path — strictly strip all leading slashes before resolving.
  const cleanPath = filePath.replace(/^(\/|\\)+/, "");
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.resolve(projectDir, normalized);
  const relativeToProject = path.relative(path.resolve(projectDir), fullPath);
  
  // Security: ensure the file stays within the project directory
  if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
    console.log("❌ Blocked:", filePath, "(path escape attempt)");
    throw new Error(`Security Exception: Path traversal denied for ${filePath}`);
  }

  try {
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // === SURGICAL EDIT MODE (search/replace) ===
    if (edits && Array.isArray(edits) && edits.length > 0) {
      if (!fs.existsSync(fullPath)) {
        console.log("  ❌ Cannot edit (file doesn't exist):", normalized);
        return;
      }
      let content = fs.readFileSync(fullPath, "utf8");
      let applied = 0, failed = 0;

      for (const edit of edits) {
        if (!edit.search || typeof edit.replace !== "string") {
          console.log("    ⚠️  Skipped invalid edit (missing search/replace)");
          failed++;
          continue;
        }
        const result = fuzzyFindAndReplace(content, edit.search, edit.replace);
        if (result !== null) {
          content = result;
          applied++;
        } else {
          console.log(`    ⚠️  Could not find match for search block (${edit.search.split("\n").length} lines)`);
          failed++;
        }
      }

      fs.writeFileSync(fullPath, content, "utf8");
      console.log(`  🔧 Surgical edit: ${normalized} (${applied} applied, ${failed} failed)`);
      return;
    }

    // === FULL OVERWRITE MODE (backward-compatible) ===
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, newContent, "utf8");
      console.log("  📄 Created:", normalized);
      return;
    }

    const oldContent = fs.readFileSync(fullPath, "utf8");
    if (oldContent === newContent) {
      console.log("  ✓ No change:", normalized);
      return;
    }

    const patch = createPatch(filePath, oldContent, newContent);
    fs.writeFileSync(fullPath, newContent, "utf8");
    console.log("  🛠 Patched:", normalized);
  } catch (e) {
    console.log("  ❌ Failed to write:", normalized, "—", e.message);
  }
}
