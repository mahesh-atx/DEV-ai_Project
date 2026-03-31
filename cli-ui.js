import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import inquirer from "inquirer";
import inquirerSearchList from "inquirer-search-list";
import readline from "readline";
import fs from "fs";

inquirer.registerPrompt("search-list", inquirerSearchList);

const theme = {
  accent: chalk.cyan,     // Headers, active inputs
  accentSoft: chalk.cyan, 
  blue: chalk.blueBright,
  violet: chalk.magenta,
  success: chalk.green,   // Success actions
  warning: chalk.yellow,  // Warnings, read-only stats
  danger: chalk.red,      // Errors
  text: chalk.white,      // Main text
  muted: chalk.gray,      // Labels, secondary text
  faint: chalk.gray,
  border: chalk.gray,
};

const symbols = {
  line: "─",
  bullet: "•",
  pointer: "›",
  prompt: "◆",
  success: "●",
  warning: "▲",
  error: "■",
  info: "·",
};

function terminalWidth() {
  return Math.max(72, Math.min(process.stdout.columns || 100, 110));
}

function separator(width = terminalWidth() - 8) {
  return theme.faint(symbols.line.repeat(Math.max(16, width)));
}

function colorize(color, text) {
  if (!color) return text;
  if (typeof color === "function") return color(text);
  return chalk[color] ? chalk[color](text) : text;
}

function panel(content, options = {}) {
  const width = Math.min(terminalWidth() - 6, options.width || terminalWidth() - 10);
  return boxen(content, {
    padding: options.padding ?? { top: 0, right: 1, bottom: 0, left: 1 },
    margin: options.margin ?? { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: options.borderStyle || "round",
    borderColor: options.borderColor || "#223247",
    dimBorder: false,
    width,
  });
}

export async function showAsciiWelcomeScreen() {
  process.stdout.write(
    process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H'
  );
  const asciiArt = `
${theme.accentSoft("██████╗ ███████╗██╗   ██╗ █████╗ ██╗")}
${theme.accentSoft("██╔══██╗██╔════╝██║   ██║██╔══██╗██║")}
${theme.accentSoft("██║  ██║█████╗  ██║   ██║███████║██║")}
${theme.accentSoft("██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██║██║")}
${theme.accentSoft("██████╔╝███████╗ ╚████╔╝ ██║  ██║██║")}
${theme.accentSoft("╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝")}

${theme.accent("  ██████╗  ██████╗ ██████╗ ███████╗")}
${theme.accent(" ██╔════╝ ██╔═══██╗██╔══██╗██╔════╝")}
${theme.accent(" ██║      ██║   ██║██║  ██║█████╗  ")}
${theme.accent(" ██║      ██║   ██║██║  ██║██╔══╝  ")}
${theme.accent(" ╚██████╗ ╚██████╔╝██████╔╝███████╗")}
${theme.accent("  ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝")}

${theme.muted("------------------------------------------------------------")}

${theme.success("Press ENTER to continue")}
${theme.danger("Press CTRL + C to exit")}

${theme.muted("------------------------------------------------------------")}
`;
  console.log(asciiArt);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question("", () => {
      rl.close();
      process.stdout.write(
        process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H'
      );
      resolve();
    });
  });
}

export function showWelcomeBanner(title, subtitle = "") {
  const lines = [
    theme.accent(title),
    subtitle ? theme.muted(subtitle) : null,
    separator(terminalWidth() - 18),
  ].filter(Boolean);

  console.log("");
  console.log(panel(lines.join("\n"), {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#2a3f57",
  }));
  console.log("");
}

export function showSection(title, icon = "") {
  const prefix = icon ? `${icon} ` : "";
  console.log("\n" + theme.text.bold(`${prefix}${title}`));
  console.log("  " + separator(terminalWidth() - 12));
}

export function showHeader(text, level = 1) {
  if (level === 1) {
    showSection(text);
    return;
  }

  if (level === 2) {
    console.log("\n" + theme.accentSoft.bold(text));
    return;
  }

  console.log(theme.muted(`  ${symbols.pointer} ${text}`));
}

export function showSubsection(text) {
  console.log(theme.muted(`  ${text}`));
}

export async function selectModelInteractive(models) {
  console.log(theme.muted("  Search and pick a model"));

  const choices = models.map((model) => {
    const badge = model.supportsThinking ? theme.violet("thinking") : theme.faint("standard");
    const desc = theme.muted(model.description);
    return {
      name: `${theme.text.bold(model.name.padEnd(28))} ${badge}  ${desc}`,
      value: model.key,
      short: model.name,
    };
  });

  const answer = await inquirer.prompt([
    {
      type: "search-list",
      name: "model",
      message: theme.text.bold("Model"),
      choices,
      pageSize: 8,
    },
  ]);

  const selected = models.find((model) => model.key === answer.model);
  showSuccess(`Model selected: ${selected?.name || answer.model}`);
  return answer.model;
}

export function showModelDetails(model) {
  if (!model) return;

  const rows = [
    `${theme.muted("ID        ")} ${theme.text(model.id)}`,
    `${theme.muted("Context   ")} ${theme.text((model.contextLimit || 0).toLocaleString() + " tokens")}`,
    `${theme.muted("Output    ")} ${theme.text((model.maxTokens || 0).toLocaleString() + " max")}`,
    `${theme.muted("Vision    ")} ${theme.text(model.isMultimodal ? "enabled" : "disabled")}`,
  ];

  console.log(panel(rows.join("\n"), {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#20364c",
  }));
}

const MODE_INFO = {
  standard: {
    label: "Standard",
    badge: theme.warning("STD"),
    color: theme.warning,
    desc: "Single pass generation and apply flow",
    aliases: ["s", "std", "1"],
  },
  agent: {
    label: "Agent",
    badge: theme.blue("AGT"),
    color: theme.blue,
    desc: "Builder to debug pipeline",
    aliases: ["a", "ag", "2"],
  },
  polish: {
    label: "Polish",
    badge: theme.violet("POL"),
    color: theme.violet,
    desc: "Pipeline plus refinement pass",
    aliases: ["p", "pol", "3"],
  },
  orchestrator: {
    label: "Orchestrator",
    badge: theme.accent("ORC"),
    color: theme.accent,
    desc: "Parallel multi-agent execution pipeline",
    aliases: ["o", "orc", "4"],
  },
  planner: {
    label: "Planner",
    badge: theme.success("PLN"),
    color: theme.success,
    desc: "Read-only exploration and plan creation",
    aliases: ["pl", "plan", "5"],
  },
  ask: {
    label: "Ask Only",
    badge: theme.success("ASK"),
    color: theme.success,
    desc: "Conversation-only mode — text responses, no changes",
    aliases: ["q", "ask", "6"],
  },
};

function resolveModeInput(raw) {
  const normalized = raw.trim().toLowerCase();
  if (MODE_INFO[normalized]) return normalized;
  for (const [key, info] of Object.entries(MODE_INFO)) {
    if (info.aliases.includes(normalized)) return key;
  }
  return null;
}

function printModeTable() {
  const lines = Object.values(MODE_INFO).map((mode) =>
    `  ${mode.badge}  ${theme.text.bold(mode.label.padEnd(10))} ${theme.muted(mode.desc)} ${theme.faint("(" + mode.aliases.join(", ") + ")")}`
  );

  console.log(panel(lines.join("\n"), {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#223247",
  }));
}

export async function selectExecutionMode() {
  console.log(theme.muted("  Search and pick an execution mode"));

  const choices = Object.entries(MODE_INFO).map(([key, info]) => ({
    name: `${info.badge}  ${info.color(info.label.padEnd(14))} ${theme.muted(info.desc)}`,
    value: key,
    short: info.label,
  }));

  const answer = await inquirer.prompt([
    {
      type: "search-list",
      name: "mode",
      message: theme.text.bold("Mode"),
      choices,
      pageSize: 6,
    },
  ]);

  const mode = MODE_INFO[answer.mode];
  showSuccess(`Mode selected: ${mode.label}`);
  return answer.mode;
}

export function showModeDetails(mode) {
  const detail = MODE_INFO[mode];
  if (!detail) return;
  console.log(theme.muted(`  ${detail.desc}`));
}

export function getModeColor(mode) {
  const detail = MODE_INFO[mode];
  return detail?.color || theme.accent;
}

export function getModeInfo(mode) {
  return MODE_INFO[mode] || null;
}

export async function showMainMenu() {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: theme.text.bold("Action"),
      choices: [
        { name: "Chat", value: "chat" },
        { name: "Run agent pipeline", value: "agent" },
        { name: "Settings", value: "settings" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);
  return answer.action;
}

export async function showBuildMenu() {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: theme.text.bold("Build and debug"),
      choices: [
        { name: "Run detected command", value: "default" },
        { name: "Set custom command", value: "custom" },
        { name: "Skip", value: "skip" },
      ],
    },
  ]);
  return answer.action;
}

export async function confirm(message, defaultValue = true) {
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: theme.text.bold(message),
      default: defaultValue,
    },
  ]);
  return answer.confirmed;
}

export async function showChangeReview(changes) {
  console.log("");
  showSection("Change Review");
  if (Array.isArray(changes)) {
    changes.forEach((change, index) => {
      console.log(`  ${theme.faint(String(index + 1).padStart(2, "0"))}  ${theme.text(change.file)} ${theme.muted("(" + change.lines + " lines)")}`);
    });
  } else {
    console.log(theme.muted(`  ${changes}`));
  }

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: theme.text.bold("Keep changes?"),
      choices: [
        { name: "Keep", value: "keep" },
        { name: "Undo", value: "undo" },
        { name: "Review again", value: "review" },
      ],
    },
  ]);
  return answer.action;
}

// Singleton spinner tracker — only one ora spinner should be active at a time
let _activeOraSpinner = null;

export function createSpinner(text) {
  if (_activeOraSpinner && _activeOraSpinner.isSpinning) {
    _activeOraSpinner.stop();
  }
  const s = ora({
    text: theme.muted(text),
    spinner: "dots",
    color: "cyan",
  });
  _activeOraSpinner = s;
  return s;
}

export function createAgentSpinner(phase = "generating") {
  if (_activeOraSpinner && _activeOraSpinner.isSpinning) {
    _activeOraSpinner.stop();
  }
  const labels = {
    building: "Building plan",
    debugging: "Debugging build",
    polishing: "Polishing output",
    analyzing: "Analyzing codebase",
    thinking: "Thinking",
    generating: "Generating response",
  };

  const s = ora({
    text: theme.muted(labels[phase] || labels.generating),
    spinner: "dots",
    color: phase === "debugging" ? "yellow" : phase === "polishing" ? "blue" : "cyan",
  });
  _activeOraSpinner = s;
  return s;
}

function progressBar(percent, width = 26) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function createStreamingPanel(options = {}) {
  const state = {
    label: options.label || "Generating",
    chars: 0,
    reasoningChars: 0,
    reasoningText: "",
    files: new Set(),
    startTime: Date.now(),
    thinkingOpen: false,
    renderedLines: 0,
    mounted: false,
    stopped: false,
    listener: null,
    previousRawMode: false,
    finalPercent: 0,
    fileOrder: [],
  };

  function clampText(text, maxWidth = terminalWidth() - 6) {
    if (text.length <= maxWidth) return text;
    return text.slice(0, Math.max(0, maxWidth - 3)) + "...";
  }

  function estimatePercent() {
    if (state.stopped) return 100;
    const elapsedMs = Date.now() - state.startTime;
    const charProgress = (1 - Math.exp(-state.chars / 2200)) * 72;
    const timeProgress = Math.min(14, elapsedMs / 500);
    const reasoningProgress = Math.min(8, state.reasoningChars / 320);
    const fileProgress = Math.min(6, state.files.size * 2);
    return Math.max(state.finalPercent, Math.min(94, Math.round(charProgress + timeProgress + reasoningProgress + fileProgress)));
  }

  function getReasoningLines() {
    if (!state.reasoningText) {
      return [theme.faint("  thinking not available yet")];
    }

    const lines = state.reasoningText
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const windowSize = 4;
    const visible = lines.slice(-windowSize).map(line => clampText(line, terminalWidth() - 14));
    
    while (visible.length < windowSize) {
      visible.push("");
    }

    const lineLen = terminalWidth() - 8;
    const boxLines = [
       theme.faint("  ╭─ ") + theme.violet("🧠 Thinking") + theme.faint(" " + "─".repeat(Math.max(2, lineLen - 15)) + "╮")
    ];
    visible.forEach(line => {
       boxLines.push(theme.faint("  │  ") + theme.muted(line.padEnd(Math.max(2, lineLen - 6))) + theme.faint("  │"));
    });
    boxLines.push(theme.faint("  ╰" + "─".repeat(Math.max(2, lineLen - 2)) + "╯"));
    return boxLines;
  }

  function buildLines() {
    const percent = estimatePercent();
    const elapsedMs = Date.now() - state.startTime;
    const width = Math.max(10, Math.min(22, terminalWidth() - 40));
    const status = `${theme.accent(clampText(state.label, 22))} ${theme.accentSoft(progressBar(percent, width))} ${theme.text(percent + "%")}`;
    const meta = [
      `chars ${state.chars.toLocaleString()}`,
      `thinking ${state.reasoningChars.toLocaleString()}`,
      `files ${state.files.size}`,
      `time ${formatTime(elapsedMs)}`,
    ].join("  •  ");

    const lines = [];

    if (state.reasoningChars > 0) {
      lines.push(...getReasoningLines());
    }

    lines.push(`  ${status}`);
    lines.push(`  ${theme.muted(meta)}`);

    if (state.fileOrder.length > 0) {
      lines.push(`  ${theme.blue("Files detected")}`);
      const visibleFiles = state.fileOrder.slice(-4);
      for (const filePath of visibleFiles) {
        lines.push(theme.muted(`  ${clampText(filePath, terminalWidth() - 6)}`));
      }
    }

    return lines;
  }

  function render() {
    if (!state.mounted) return;

    const lines = buildLines();
    const total = Math.max(lines.length, state.renderedLines);

    if (state.renderedLines > 1) {
      readline.moveCursor(process.stdout, 0, -(state.renderedLines - 1));
    }

    for (let index = 0; index < total; index++) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      if (index < lines.length) {
        process.stdout.write(lines[index]);
      }
      if (index < total - 1) process.stdout.write("\n");
    }

    state.renderedLines = lines.length;
  }

  function mount() {
    if (state.mounted) return;
    
    if (_activeOraSpinner && _activeOraSpinner.isSpinning) {
      _activeOraSpinner.stop();
      _activeOraSpinner.clear();
    }
    
    state.mounted = true;
    process.stdout.write("\n");
    state.renderedLines = 1;

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      state.previousRawMode = !!process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      state.listener = (buffer) => {
        const key = buffer.toString();
        if (key.toLowerCase() === "t") {
          state.thinkingOpen = !state.thinkingOpen;
          render();
        } else if (key === "\u0003") {
          process.emit("SIGINT");
        }
      };
      process.stdin.on("data", state.listener);
    }

    render();
  }

  function update(payload = {}) {
    if (!state.mounted) mount();
    if (payload.label) state.label = payload.label;
    if (payload.chars != null) state.chars = payload.chars;
    if (payload.reasoningDelta) {
      state.reasoningText += payload.reasoningDelta;
      state.reasoningChars += payload.reasoningDelta.length;
    }
    if (payload.filePath) {
      if (!state.files.has(payload.filePath)) state.fileOrder.push(payload.filePath);
      state.files.add(payload.filePath);
    }
    if (Array.isArray(payload.files)) {
      payload.files.forEach((filePath) => {
        if (!state.files.has(filePath)) state.fileOrder.push(filePath);
        state.files.add(filePath);
      });
    }
    if (payload.percent != null) state.finalPercent = payload.percent;
    render();
  }

  function stop(extra = {}) {
    if (!state.mounted || state.stopped) return;
    state.stopped = true;
    if (extra.percent != null) state.finalPercent = extra.percent;
    const linesToClear = state.renderedLines;

    if (linesToClear > 1) {
      readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
    }

    for (let index = 0; index < linesToClear; index++) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      if (index < linesToClear - 1) process.stdout.write("\n");
    }

    if (linesToClear > 1) {
      readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
    }
    readline.cursorTo(process.stdout, 0);
    state.renderedLines = 0;
    state.mounted = false;

    if (state.listener) {
      process.stdin.off("data", state.listener);
      state.listener = null;
    }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(state.previousRawMode);
    }
  }

  return {
    mount,
    update,
    stop,
    addFile(filePath) {
      update({ filePath });
    },
  };
}

export function showStreamStart(modelName) {
  console.log("\n" + theme.accent(`${symbols.prompt} ${modelName}`));
  console.log("  " + separator(terminalWidth() - 16));
}

export function showStreamEnd(stats = {}) {
  const parts = [];
  if (stats.elapsedMs != null) parts.push(`${(stats.elapsedMs / 1000).toFixed(1)}s`);
  if (stats.tokenCount != null) parts.push(`~${stats.tokenCount} tokens`);
  if (parts.length > 0) console.log(theme.muted(`  ${parts.join("  •  ")}`));
}

export function showPipelineHeader(stages = []) {
  const flow = stages.map((stage) => theme.text.bold(stage)).join(theme.faint("  →  "));
  console.log("\n" + theme.accent(`${symbols.prompt} Agent Pipeline`));
  console.log("  " + flow);
  console.log("  " + separator(terminalWidth() - 12));
}

export function showPipelineStage(stageName, status = "running", detail = "") {
  const icon =
    status === "done" ? theme.success("●") :
    status === "error" ? theme.danger("■") :
    status === "skip" ? theme.warning("▲") :
    status === "pending" ? theme.faint("○") :
    theme.blue("◌");

  const suffix = detail ? ` ${theme.muted(detail)}` : "";
  console.log(`  ${icon}  ${theme.text(stageName.padEnd(18))}${suffix}`);
}

export function printReasoningChunk(chunk) {
  if (!chunk) return;
  process.stdout.write(theme.faint(chunk));
}

export function showReasoningStart() {
  console.log("\n" + theme.faint("  thinking"));
  console.log(theme.faint("  " + symbols.line.repeat(24)));
}

export function showReasoningEnd(charCount = 0) {
  console.log("\n" + theme.faint(`  done  ${charCount} chars`));
}

export async function showCollapsibleReasoning(reasoningText) {
  if (!reasoningText || !reasoningText.trim()) return;
  console.log(panel(theme.faint(reasoningText), {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#223247",
  }));
}

export function showThinkingBlock(text) {
  if (!text) return;
  process.stdout.write(theme.faint(text));
}

export function showSessionStats(stats = {}) {
  const rows = [];
  if (stats.messages != null) rows.push(`${theme.muted("Messages")}  ${theme.text(String(stats.messages))}`);
  if (stats.tokensUsed != null) rows.push(`${theme.muted("Tokens")}    ${theme.text("~" + Number(stats.tokensUsed).toLocaleString())}`);
  if (stats.elapsedMs != null) rows.push(`${theme.muted("Time")}      ${theme.text(formatTime(stats.elapsedMs))}`);
  if (rows.length > 0) console.log(panel(rows.join("\n"), { borderColor: "#20364c" }));
}

export function showSuccess(message, icon = symbols.success) {
  console.log(theme.success(`  ${icon}  ${message}`));
}

export function showError(message, icon = symbols.error) {
  console.log(theme.danger(`  ${icon}  ${message}`));
}

export function showWarning(message, icon = symbols.warning) {
  console.log(theme.warning(`  ${icon}  ${message}`));
}

export function showInfo(message, icon = symbols.info) {
  console.log(theme.muted(`  ${icon}  ${message}`));
}

export function showProgress(current, total, label = "Progress") {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const barLength = 24;
  const filled = Math.min(barLength, Math.round((barLength * current) / Math.max(total, 1)));
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
  const color = percent >= 90 ? theme.danger : percent >= 70 ? theme.warning : theme.accent;
  console.log(`  ${theme.muted(label.padEnd(10))} ${color(bar)} ${theme.text(percent + "%")}`);
}

export function showTokenUsage(stats) {
  const { tokens, total, percent, isHigh, isCritical } = stats;
  const barLength = 24;
  const filled = Math.min(barLength, Math.round((barLength * percent) / 100));
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
  const color = isCritical ? theme.danger : isHigh ? theme.warning : theme.accent;
  console.log(`  ${theme.muted("Context".padEnd(10))} ${color(bar)} ${theme.text(percent + "%")} ${theme.muted(`${tokens.toLocaleString()} / ${total.toLocaleString()}`)}`);
}

export function showTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length)) + 2
  );

  console.log("");
  console.log("  " + headers.map((header, index) => theme.text.bold(header.padEnd(widths[index]))).join(""));
  console.log("  " + separator(widths.reduce((sum, width) => sum + width, 0)));
  for (const row of rows) {
    console.log("  " + row.map((cell, index) => theme.muted(String(cell ?? "").padEnd(widths[index]))).join(""));
  }
}

export function showList(items) {
  for (const item of items) {
    const icon = item.icon || symbols.bullet;
    const text = item.text || item;
    const color = item.color || theme.muted;
    console.log(colorize(color, `  ${icon}  ${text}`));
  }
}

export async function promptInput(message, defaultValue = "", options = {}) {
  const colorFn = options.color || theme.accent;
  if (options.anchor !== false) {
    console.log("  " + theme.faint(symbols.line.repeat(Math.max(16, terminalWidth() - 12))));
  }
  const answer = await inquirer.prompt([
    {
      type: "input",
      name: "input",
      message: colorFn.bold ? colorFn.bold(message) : colorFn(message),
      default: defaultValue,
      prefix: colorFn(symbols.prompt),
    },
  ]);
  return answer.input;
}

export async function promptPassword(message) {
  const answer = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      message: theme.text.bold(message),
      mask: "•",
      prefix: theme.accent(symbols.prompt),
    },
  ]);
  return answer.password;
}

export async function promptMultiSelect(message, choices) {
  const answer = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selected",
      message: theme.text.bold(message),
      choices: choices.map((choice) => ({
        name: choice.name || choice,
        value: choice.value !== undefined ? choice.value : choice,
      })),
      prefix: theme.accent(symbols.prompt),
    },
  ]);
  return answer.selected;
}

export function showCodeBlock(code, language = "") {
  const header = language ? `${language}` : "output";
  console.log(panel(`${theme.muted(header)}\n${theme.text(code)}`, {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#223247",
  }));
}

export function showBox(content) {
  console.log(panel(content, {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    borderColor: "#29405a",
  }));
}

export function showStats(stats) {
  const rows = Object.entries(stats).map(([key, value]) => `${theme.muted(key.padEnd(16))} ${theme.text(String(value))}`);
  console.log(panel(rows.join("\n"), { borderColor: "#20364c" }));
}

export function showTimeline(steps) {
  console.log("");
  for (const [index, step] of steps.entries()) {
    const connector = index === steps.length - 1 ? "└" : "├";
    const icon =
      step.status === "done" ? theme.success("●") :
      step.status === "error" ? theme.danger("■") :
      step.status === "pending" ? theme.faint("○") :
      theme.blue("◌");
    const detail = step.detail ? ` ${theme.muted(step.detail)}` : "";
    console.log(`  ${connector}─ ${icon} ${theme.text(step.label)}${detail}`);
  }
}

export function updateTimeline(steps, stepIndex, status, detail = "") {
  steps[stepIndex].status = status;
  if (detail) steps[stepIndex].detail = detail;
  return steps;
}

export function createLiveFileTracker() {
  let buffer = "";
  let totalChars = 0;
  const detectedFiles = [];
  const pathRegex = /"path"\s*:\s*"([^"]+)"/g;
  let lastSearchPos = 0;
  let started = false;

  function feed(chunk) {
    if (!chunk) return;
    buffer += chunk;
    totalChars += chunk.length;
    pathRegex.lastIndex = Math.max(0, lastSearchPos - 30);

    let match;
    while ((match = pathRegex.exec(buffer)) !== null) {
      const filePath = match[1];
      if (detectedFiles.includes(filePath)) continue;
      detectedFiles.push(filePath);
      if (!started) {
        console.log("\n" + theme.text.bold("  Files in response"));
        started = true;
      }
      console.log(theme.muted(`  ${_fileIcon(filePath)}  ${filePath}`));
    }

    lastSearchPos = buffer.length;
  }

  function done() {
    if (detectedFiles.length > 0) {
      console.log(theme.faint(`  ${detectedFiles.length} file(s) detected`));
    }
    return { files: detectedFiles, chars: totalChars };
  }

  function getFiles() {
    return detectedFiles;
  }

  return { feed, done, getFiles };
}

export function showToolExecution(toolName, argsStr = "") {
  // STEP 2: Collapsed tool output — clean one-liner instead of dumping raw output
  const icon = toolName.includes("write") || toolName.includes("edit")
    ? theme.success("✔")
    : toolName.includes("run_command")
    ? theme.accent("⚡")
    : theme.blue("▶");

  // Extract just the file path or short description from args
  const shortArgs = argsStr
    .replace(/content="[^"]*"/g, '') // strip file content dumps
    .replace(/edits="[^"]*"/g, '')   // strip edit payloads
    .replace(/,,/g, ',')
    .replace(/^,|,$/g, '')
    .trim();

  const argDisplay = shortArgs ? theme.muted(` → ${shortArgs}`) : "";
  console.log(`  ${icon} ${theme.text.bold(toolName)}${argDisplay}`);
}

export function showToolResult(resultStr) {
  // STEP 2: Collapsed — only show first 80 chars on one muted line
  const preview = String(resultStr).split('\n')[0].slice(0, 80);
  const suffix = String(resultStr).length > 80 ? theme.faint("…") : "";
  console.log(`     ${theme.faint("└")} ${theme.muted(preview)}${suffix}`);
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: Phase-Aware Spinner
// ═══════════════════════════════════════════════════════════════

const PHASE_COLORS = {
  planning: theme.blue,
  exploring: theme.blue,
  building: theme.success,
  coding: theme.success,
  testing: theme.warning,
  debugging: theme.warning,
  error: theme.danger,
  general: theme.accent,
};

export function phaseColor(phase) {
  return PHASE_COLORS[phase] || theme.accent;
}

export function createPhaseSpinner(phase = "general", text = "Thinking...") {
  // Stop any previously active spinner to prevent concurrent spinner warnings
  if (_activeOraSpinner && _activeOraSpinner.isSpinning) {
    _activeOraSpinner.stop();
  }

  const color = phase === "planning" ? "cyan"
    : phase === "building" || phase === "coding" ? "green"
    : phase === "testing" || phase === "debugging" ? "yellow"
    : "cyan";

  const spinner = ora({
    text: phaseColor(phase)(text),
    spinner: "dots",
    color,
    indent: 2,
  });
  spinner.start();
  _activeOraSpinner = spinner;

  return {
    update(newText) {
      spinner.text = phaseColor(phase)(newText);
    },
    succeed(msg) {
      spinner.succeed(phaseColor(phase)(msg || text));
      if (_activeOraSpinner === spinner) _activeOraSpinner = null;
    },
    fail(msg) {
      spinner.fail(theme.danger(msg || "Failed"));
      if (_activeOraSpinner === spinner) _activeOraSpinner = null;
    },
    stop() {
      spinner.stop();
      if (_activeOraSpinner === spinner) _activeOraSpinner = null;
    },
    raw: spinner,
  };
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: Color-Coded Phase Header
// ═══════════════════════════════════════════════════════════════

export function showPhaseHeader(phase, label) {
  const colorFn = phaseColor(phase);
  const icons = {
    planning: "🔵",
    exploring: "🔍",
    building: "🟢",
    coding: "🟢",
    testing: "🟡",
    debugging: "🟡",
    error: "🔴",
    general: "⚡",
  };
  const icon = icons[phase] || "⚡";
  console.log("");
  console.log(`  ${icon} ${colorFn.bold(label)}`);
  console.log(`  ${theme.faint("─".repeat(Math.min(50, terminalWidth() - 12)))}`);
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: Progress Bar
// ═══════════════════════════════════════════════════════════════

export function renderProgressBar(current, total, label = "Progress") {
  const barWidth = 20;
  const filled = Math.round((current / Math.max(total, 1)) * barWidth);
  const bar = theme.accent("█".repeat(filled)) + theme.faint("░".repeat(barWidth - filled));
  const pct = Math.round((current / Math.max(total, 1)) * 100);
  return `  ${theme.muted(label)}: ${bar} ${theme.text(`${current}/${total}`)} ${theme.faint(`(${pct}%)`)}`;
}

export function showProgressBar(current, total, label = "Progress") {
  console.log(renderProgressBar(current, total, label));
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: Live Status Line (in-place update)
// ═══════════════════════════════════════════════════════════════

export function updateStatusLine(text) {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(`  ${theme.accent("⠸")} ${theme.text(text)}`);
}

export function clearStatusLine() {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
}

// ═══════════════════════════════════════════════════════════════
// STEP 6: Final Summary Card
// ═══════════════════════════════════════════════════════════════

export function showSummaryCard(stats = {}) {
  const {
    filesCreated = 0,
    filesEdited = 0,
    commandsRun = 0,
    errors = 0,
    duration = "0s",
    loopCount = 0,
  } = stats;

  const width = Math.min(50, terminalWidth() - 10);
  const border = "─".repeat(width - 2);

  console.log("");
  console.log(`  ${theme.accent(`╭${border}╮`)}`);
  console.log(`  ${theme.accent("│")} ${theme.text.bold("Execution Complete".padEnd(width - 4))} ${theme.accent("│")}`);
  console.log(`  ${theme.accent(`├${border}┤`)}`);

  const lines = [];
  if (filesCreated > 0) lines.push(`  ${theme.success("✔")} Files created   : ${filesCreated}`);
  if (filesEdited > 0) lines.push(`  ${theme.success("✔")} Files edited    : ${filesEdited}`);
  if (commandsRun > 0) lines.push(`  ${theme.success("✔")} Commands run    : ${commandsRun}`);
  if (errors > 0) lines.push(`  ${theme.danger("✗")} Errors          : ${errors}`);
  lines.push(`  ${theme.accent("⏱")} Total time      : ${duration}`);
  if (loopCount > 0) lines.push(`  ${theme.muted("↻")} Agent turns     : ${loopCount}`);

  for (const line of lines) {
    const plainLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    const pad = Math.max(0, width - 2 - plainLen);
    console.log(`${theme.accent("│")}${line}${" ".repeat(pad)}${theme.accent("│")}`);
  }

  console.log(`  ${theme.accent(`╰${border}╯`)}`);
  console.log("");
}

function wrapText(text, maxWidth) {
  if (text.length <= maxWidth) return [text];
  const lines = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxWidth) {
      lines.push(remaining);
      break;
    }
    // Find last space within maxWidth to word-wrap cleanly
    let breakAt = remaining.lastIndexOf(' ', maxWidth);
    if (breakAt <= 0) breakAt = maxWidth; // No space found, hard break
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return lines;
}

export function showPlanBox(planObj) {
  const width = Math.min(80, terminalWidth() - 6);
  const innerWidth = width - 4;
  const border = theme.success("─".repeat(Math.max(10, width - 2)));
  console.log("");
  console.log(theme.success(`  ╭${border}╮`));
  console.log(theme.success(`  │ `) + theme.text.bold(`📋 IMPLEMENTATION PLAN`.padEnd(innerWidth)) + theme.success(` │`));
  console.log(theme.success(`  ├${border}┤`));
  
  if (planObj.plan && Array.isArray(planObj.plan)) {
    planObj.plan.forEach((step, index) => {
       const prefix = `${index + 1}. `;
       const indent = " ".repeat(prefix.length);
       const firstLineMax = innerWidth - prefix.length;
       const wrapped = wrapText(step, firstLineMax);
       // First line with number prefix
       console.log(theme.success(`  │ `) + theme.accent(prefix) + theme.text(wrapped[0].padEnd(firstLineMax)) + theme.success(` │`));
       // Continuation lines indented
       for (let i = 1; i < wrapped.length; i++) {
         const line = indent + wrapped[i];
         console.log(theme.success(`  │ `) + theme.text(line.padEnd(innerWidth)) + theme.success(` │`));
       }
    });
  }

  if (planObj.confidenceScore !== undefined) {
      console.log(theme.success(`  ├${border}┤`));
      const score = Number(planObj.confidenceScore);
      const filled = Math.round((score / 100) * 10);
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const confStr = `📊 Quality: ${theme.accent(bar)} ${score}%`;
      const plainLen = 12 + 10 + String(score).length; 
      const padLen = Math.max(0, width - 4 - plainLen);
      console.log(theme.success(`  │ `) + confStr + " ".repeat(padLen) + theme.success(` │`));
  }

  console.log(theme.success(`  ╰${border}╯`));
  console.log("");
}

export function showFileWriting(filePath, status = "writing") {
  const icon =
    status === "done" ? theme.success("●") :
    status === "error" ? theme.danger("■") :
    theme.blue("◌");
  console.log(`  ${icon}  ${_fileIcon(filePath)}  ${theme.text(filePath)}`);
}

function _fileIcon(filePathOrExt) {
  const ext = filePathOrExt.includes(".")
    ? filePathOrExt.split(".").pop()
    : filePathOrExt;

  const icons = {
    js: "js",
    jsx: "jsx",
    ts: "ts",
    tsx: "tsx",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    md: "md",
    py: "py",
    rb: "rb",
    go: "go",
    env: "env",
    yml: "yml",
    yaml: "yaml",
    sh: "sh",
    bat: "bat",
    ps1: "ps1",
  };
  return icons[ext] || "file";
}

export function clearScreen() {
  console.clear();
}

export function showSeparator() {
  console.log("  " + separator(terminalWidth() - 12));
}

export function showDivider() {
  console.log("  " + separator(terminalWidth() - 12));
}

export function pause(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatBytes(bytes) {
  const sizes = ["B", "KB", "MB", "GB"];
  if (bytes === 0) return "0 B";
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${sizes[index]}`;
}

export function logErrorToFile(err, context = "") {
  try {
    const timestamp = new Date().toISOString();
    const errorMessage = err && err instanceof Error ? err.stack || err.message : String(err);
    const logLine = `[${timestamp}] ${context ? `[${context}] ` : ""}${errorMessage}\n`;
    fs.appendFileSync("devai-error.log", logLine);
  } catch (e) {
    // silently fail
  }
}

export default {
  createSpinner,
  createAgentSpinner,
  showWelcomeBanner,
  showAsciiWelcomeScreen,
  showSection,
  showHeader,
  showSubsection,
  selectModelInteractive,
  showModelDetails,
  selectExecutionMode,
  showModeDetails,
  getModeColor,
  getModeInfo,
  showMainMenu,
  showBuildMenu,
  confirm,
  showChangeReview,
  createPhaseSpinner,
  showPhaseHeader,
  phaseColor,
  createStreamingPanel,
  showStreamStart,
  showStreamEnd,
  showPipelineHeader,
  showPipelineStage,
  printReasoningChunk,
  showReasoningStart,
  showReasoningEnd,
  showCollapsibleReasoning,
  showThinkingBlock,
  showSessionStats,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showProgress,
  showTokenUsage,
  showTable,
  showList,
  promptInput,
  promptPassword,
  promptMultiSelect,
  showCodeBlock,
  showBox,
  showStats,
  showTimeline,
  updateTimeline,
  createLiveFileTracker,
  showToolExecution,
  showToolResult,
  showPlanBox,
  showFileWriting,
  renderProgressBar,
  showProgressBar,
  updateStatusLine,
  clearStatusLine,
  showSummaryCard,
  clearScreen,
  showSeparator,
  showDivider,
  pause,
  formatTime,
  formatBytes,
  logErrorToFile,
};
