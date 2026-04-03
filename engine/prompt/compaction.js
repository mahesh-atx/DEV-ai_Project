const COMPACT_CONTINUATION_PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n";
const COMPACT_RECENT_MESSAGES_NOTE = "Recent messages are preserved verbatim.";
const COMPACT_DIRECT_RESUME_INSTRUCTION =
  "Continue the conversation from where it left off without asking the user any further questions. Resume directly - do not acknowledge the summary, do not recap what was happening, and do not preface with continuation text.";

export const DEFAULT_COMPACTION_CONFIG = {
  preserveRecentMessages: 4,
  maxEstimatedTokens: 10000,
};

function collapseBlankLines(content = "") {
  const lines = String(content).split(/\r?\n/);
  const next = [];
  let previousBlank = false;

  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank && previousBlank) continue;
    next.push(line.trimEnd());
    previousBlank = isBlank;
  }

  return next.join("\n");
}

function stripTagBlock(content, tagName) {
  return String(content || "").replace(new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, "g"), "");
}

function extractTagBlock(content, tagName) {
  const match = String(content || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? match[1] : null;
}

function getMessageRole(message = {}) {
  return message.role || message.type || "unknown";
}

function getMessageText(message = {}) {
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function summarizeMessage(message = {}) {
  const text = getMessageText(message).replace(/\s+/g, " ").trim();
  if (!text) return "(no text)";
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function collectRecentRoleSummaries(messages, role, limit) {
  return messages
    .filter((message) => getMessageRole(message) === role)
    .slice(-limit)
    .map(summarizeMessage);
}

function collectKeyFiles(messages) {
  const filePattern = /\b(?:[A-Za-z]:)?[\\/][\w .\-\\/]+\.\w+\b|(?:^|[\s(])([\w./-]+\.\w+)(?=$|[\s),])/g;
  const files = new Set();

  for (const message of messages) {
    const text = getMessageText(message);
    let match;
    while ((match = filePattern.exec(text))) {
      const filePath = match[0].trim();
      if (filePath.length < 3) continue;
      files.add(filePath.replace(/^[\s(]+/, ""));
      if (files.size >= 8) return [...files];
    }
  }

  return [...files];
}

function inferPendingWork(messages) {
  const pending = [];

  for (const message of messages.slice(-8)) {
    const role = getMessageRole(message);
    const text = getMessageText(message).toLowerCase();
    if (role === "user" && text) {
      pending.push(`User asked: ${summarizeMessage(message)}`);
    } else if (role === "system" && text.includes("error")) {
      pending.push(`System reported: ${summarizeMessage(message)}`);
    }
  }

  return pending.slice(-3);
}

function inferCurrentWork(messages) {
  const lastAssistant = [...messages].reverse().find((message) => getMessageRole(message) === "assistant");
  return lastAssistant ? summarizeMessage(lastAssistant) : null;
}

function summarizeMessages(messages = []) {
  const counts = {
    user: 0,
    assistant: 0,
    tool: 0,
    system: 0,
  };

  for (const message of messages) {
    const role = getMessageRole(message);
    if (counts[role] !== undefined) counts[role] += 1;
  }

  const lines = [
    "<summary>",
    "Conversation summary:",
    `- Scope: ${messages.length} earlier messages compacted (user=${counts.user}, assistant=${counts.assistant}, tool=${counts.tool}, system=${counts.system}).`,
  ];

  const recentRequests = collectRecentRoleSummaries(messages, "user", 3);
  if (recentRequests.length) {
    lines.push("- Recent user requests:");
    lines.push(...recentRequests.map((item) => `  - ${item}`));
  }

  const pendingWork = inferPendingWork(messages);
  if (pendingWork.length) {
    lines.push("- Pending work:");
    lines.push(...pendingWork.map((item) => `  - ${item}`));
  }

  const keyFiles = collectKeyFiles(messages);
  if (keyFiles.length) {
    lines.push(`- Key files referenced: ${keyFiles.join(", ")}.`);
  }

  const currentWork = inferCurrentWork(messages);
  if (currentWork) {
    lines.push(`- Current work: ${currentWork}`);
  }

  lines.push("- Key timeline:");
  for (const message of messages) {
    lines.push(`  - ${getMessageRole(message)}: ${summarizeMessage(message)}`);
  }
  lines.push("</summary>");
  return lines.join("\n");
}

export function estimateMessageTokens(message = {}) {
  const text = getMessageText(message);
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateConversationTokens(messages = []) {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function shouldCompactConversation(messages = [], config = {}) {
  const normalized = { ...DEFAULT_COMPACTION_CONFIG, ...(config || {}) };
  return (
    messages.length > normalized.preserveRecentMessages &&
    estimateConversationTokens(messages) >= normalized.maxEstimatedTokens
  );
}

export function formatCompactSummary(summary = "") {
  const withoutAnalysis = stripTagBlock(summary, "analysis");
  const tagContent = extractTagBlock(withoutAnalysis, "summary");
  const formatted = tagContent
    ? withoutAnalysis.replace(`<summary>${tagContent}</summary>`, `Summary:\n${tagContent.trim()}`)
    : withoutAnalysis;

  return collapseBlankLines(formatted).trim();
}

export function getCompactContinuationMessage(
  summary = "",
  suppressFollowUpQuestions = true,
  recentMessagesPreserved = true
) {
  let base = `${COMPACT_CONTINUATION_PREAMBLE}${formatCompactSummary(summary)}`;

  if (recentMessagesPreserved) {
    base += `\n\n${COMPACT_RECENT_MESSAGES_NOTE}`;
  }

  if (suppressFollowUpQuestions) {
    base += `\n${COMPACT_DIRECT_RESUME_INSTRUCTION}`;
  }

  return base.trim();
}

export function compactConversation(messages = [], config = {}) {
  const normalized = { ...DEFAULT_COMPACTION_CONFIG, ...(config || {}) };
  const compactable = Array.isArray(messages) ? messages.filter(Boolean) : [];

  if (!shouldCompactConversation(compactable, normalized)) {
    return {
      summary: "",
      formattedSummary: "",
      continuationMessage: "",
      compactedMessages: compactable,
      removedMessageCount: 0,
      preservedMessageCount: compactable.length,
    };
  }

  const keepFrom = Math.max(0, compactable.length - normalized.preserveRecentMessages);
  const removed = compactable.slice(0, keepFrom);
  const preserved = compactable.slice(keepFrom);
  const summary = summarizeMessages(removed);
  const formattedSummary = formatCompactSummary(summary);
  const continuationMessage = getCompactContinuationMessage(summary, true, preserved.length > 0);

  return {
    summary,
    formattedSummary,
    continuationMessage,
    compactedMessages: preserved,
    removedMessageCount: removed.length,
    preservedMessageCount: preserved.length,
  };
}
