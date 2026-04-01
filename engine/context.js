/**
 * engine/context.js — Project detection, file collection, and smart context building
 */

import fs from "fs";
import path from "path";
import { estimateMaxInputTokens, tokensToChars } from "../utils/budgeting.js";

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".mp4", ".mp3", ".wav", ".ogg",
  ".zip", ".tar", ".gz", ".rar",
  ".pdf", ".doc", ".docx", ".xls",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".lock"
]);

const SKIP_NAMES = new Set(["node_modules", ".git", ".devai_memory.json", "_devai_last_response.txt"]);
const CONFIG_FILES = new Set(["package.json", ".env", ".env.example", "tsconfig.json", "vite.config.js", "webpack.config.js"]);

export function detectProjectType(dir) {
  try {
    const check = (f) => fs.existsSync(path.join(dir, f));
    if (check("package.json")) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.dependencies?.react) return "React App";
      if (pkg.dependencies?.express) return "Node Express API";
      return "Node Project";
    }
    if (check("index.html")) return "Static Web";
    if (check("requirements.txt")) return "Python";
  } catch {} // skip if directory unreadable
  return "Empty / Unknown";
}

export function collectFiles(dir) {
  const files = [];
  function walk(d, prefix = "") {
    let entries;
    try { entries = fs.readdirSync(d); } catch { return; }
    for (const f of entries) {
      if (SKIP_NAMES.has(f)) continue;
      const full = path.join(d, f);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const rel = path.relative(dir, full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else if (stat.size < 100000 && !BINARY_EXTS.has(path.extname(f).toLowerCase())) {
        try {
          const content = fs.readFileSync(full, "utf8");
          const nonPrintable = content.slice(0, 500).split("").filter(c => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r" && c !== "\t").length;
          if (nonPrintable < 5) {
            const lines = content.split("\n").length;
            files.push({ path: rel, content, lines, size: stat.size, mtime: stat.mtimeMs });
          }
        } catch {} // skip unreadable files
      }
    }
  }
  try { walk(dir); } catch (e) {
    console.log("⚠️  Warning: Could not fully read codebase:", e.message);
  }
  return files;
}

export function scoreRelevance(file, keywords) {
  let score = 0;
  const name = file.path.toLowerCase();
  const basename = path.basename(name);

  if (CONFIG_FILES.has(basename)) score += 10;
  if (basename === "index.js" || basename === "index.html" || basename === "app.js" || basename === "main.js") score += 5;

  const ageMinutes = (Date.now() - file.mtime) / 60000;
  if (ageMinutes < 30) score += 4;
  else if (ageMinutes < 120) score += 2;

  for (const kw of keywords) {
    if (name.includes(kw)) score += 6;
    if (file.content.toLowerCase().includes(kw)) score += 2;
  }

  return score;
}

export function buildSmartContext(dir, userInput, modelOrBudget = 12000, messages = []) {
  let maxChars = 12000;
  if (typeof modelOrBudget === "number") {
    maxChars = modelOrBudget > 5000
      ? tokensToChars(Math.min(30000, Math.max(1024, modelOrBudget)))
      : modelOrBudget;
  } else if (modelOrBudget && typeof modelOrBudget === "object") {
    const maxInputTokens = estimateMaxInputTokens(modelOrBudget);
    maxChars = tokensToChars(Math.min(maxInputTokens, 30000));
  }
  const files = collectFiles(dir);
  if (files.length === 0) return "(empty project)";

  const tree = files.map(f => `  ${f.path} (${f.lines} lines)`).join("\n");
  const keywords = userInput.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3);

  const scored = files.map(f => ({ ...f, score: scoreRelevance(f, keywords) }))
    .sort((a, b) => b.score - a.score);

  let context = `📁 File Tree (${files.length} files):\n${tree}\n\n`;
  if (messages.length > 1) {
    const recent = messages
      .slice(-4, -1)
      .map((message) => {
        const content = typeof message.content === "string"
          ? message.content
          : String(JSON.stringify(message.content) || "");
        return `[${(message.role || "unknown").toUpperCase()}]: ${content.slice(0, 300)}${content.length > 300 ? "..." : ""}`;
      })
      .join("\n");
    if (recent) context += `\nRecent History:\n${recent}\n\n`;
  }
  let used = context.length;
  const fullFiles = [];
  const previews = [];

  for (const f of scored) {
    const fullEntry = `--- ${f.path} ---\n${f.content}\n`;
    if (used + fullEntry.length < maxChars) {
      fullFiles.push(fullEntry);
      used += fullEntry.length;
    } else {
      const preview = f.content.split("\n").slice(0, 5).join("\n");
      const previewEntry = `--- ${f.path} (preview) ---\n${preview}\n`;
      if (used + previewEntry.length < maxChars) {
        previews.push(previewEntry);
        used += previewEntry.length;
      }
    }
  }

  if (fullFiles.length > 0) context += `📄 Full Files (${fullFiles.length}):\n${fullFiles.join("\n")}`;
  if (previews.length > 0) context += `\n📝 Previews:\n${previews.join("\n")}`;

  return context;
}

export function detectBuildCommand(dir, customBuildCmd = null) {
  if (customBuildCmd) return customBuildCmd;

  try {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') return "npm test";
      if (scripts.build) return "npm run build";
      if (scripts.lint) return "npm run lint";
      return null;
    }
    if (fs.existsSync(path.join(dir, "requirements.txt"))) return "python -m pytest";
    if (fs.existsSync(path.join(dir, "Cargo.toml"))) return "cargo build";
    if (fs.existsSync(path.join(dir, "go.mod"))) return "go build ./...";
  } catch {} // skip if directory unreadable
  return null;
}
