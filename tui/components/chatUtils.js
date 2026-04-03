import stringWidth from 'string-width';

export const DEFAULT_SUMMARY = {
  filesCreated: 0,
  filesEdited: 0,
  commandsRun: 0,
  errors: 0,
  duration: '0.0s',
  loopCount: 0,
};

export const COLORS = {
  green: '#4ADE80',
  darkGreen: '#143C22',
  red: '#F87171',
  darkRed: '#451A1A',
  blue: '#60A5FA',
  orange: '#D97757',
  dim: '#71717A',
  code: '#E5C07B',
  white: '#F9FAFB',
  highlight: '#27272A',
};

export const SPINNER_FRAMES = ['|', '/', '-', '\\'];

export function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

export function stripSystemAndEnv(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\n?/g, '')
    .replace(/<environmentDetails>[\s\S]*?<\/environmentDetails>\n?/g, '')
    .replace(/<environmentDetails>[\s\S]*$/g, '')
    .replace(/Implement the plan above\.\s*$/gm, '')
    .replace(/^\s*Current time:.*$/gm, '')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text, max = 96) {
  const clean = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

export function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};

  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

export function firstNonEmptyValue(values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

export function buildToolNarration(toolCall) {
  const toolName = toolCall?.function?.name || 'tool';
  const args = parseToolArguments(toolCall?.function?.arguments);

  switch (toolName) {

    case 'read':
    case 'read_file': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `Before making any decisions, I'm opening "${path}" to read the exact implementation. I want to understand how this part of the code currently behaves, what assumptions it makes, and whether there are any edge cases or dependencies I need to be aware of. Once I've reviewed it, I'll be in a much better position to decide what needs to change (if anything).`
        : `I'm opening the relevant file to inspect the existing implementation in detail. My goal here is to fully understand the current logic, constraints, and flow before making any modifications, so I don't introduce regressions or incorrect assumptions.`;
    }

    case 'list':
    case 'list_files': {
      const path = firstNonEmptyValue([args.path, '.']);
      return `To get proper context before diving deeper, I'm listing the contents of "${path}". This helps me understand how the project is structured, where important files are located, and how different parts of the codebase are organized so I can navigate efficiently.`;
    }

    case 'glob':
    case 'search_files': {
      const pattern = firstNonEmptyValue([args.pattern]);
      return pattern
        ? `I'm searching for files matching "${pattern}" across the workspace. The goal is to quickly narrow down where the relevant logic might live, instead of manually scanning everything. Once I find the right files, I'll inspect them more closely.`
        : `I'm scanning the workspace to locate relevant files that might contain the logic I need. This step helps me avoid guesswork and ensures I'm working in the correct place.`;
    }

    case 'grep':
    case 'search_content': {
      const query = firstNonEmptyValue([args.query, args.pattern]);
      return query
        ? `I'm searching through the codebase for occurrences of "${query}". This allows me to trace how this behavior is implemented, where it originates, and how it propagates across the system. It's especially useful for identifying dependencies and hidden side effects.`
        : `I'm scanning through the codebase to trace how this behavior is implemented and connected across different modules. This helps me build a complete mental model before making changes.`;
    }

    case 'bash':
    case 'run_command': {
      const command = firstNonEmptyValue([args.command]);
      return command
        ? `To validate my understanding against reality, I'm executing "${command}" in the environment. This lets me observe the actual behavior, outputs, or errors directly, which is critical before making any assumptions or applying fixes.`
        : `I'm running a command in the environment to verify the current system state and gather real execution data. This helps ensure that my next steps are based on actual behavior, not just static analysis.`;
    }

    case 'write':
    case 'write_file': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `Now that I clearly understand what needs to be implemented, I'm writing the updated content to "${path}". This step introduces the required changes in a clean and controlled way, ensuring the new logic aligns with the existing structure.`
        : `I'm writing the necessary file changes based on the analysis I've done. At this point, I'm confident about what needs to be implemented and how it should integrate with the rest of the codebase.`;
    }

    case 'edit':
    case 'edit_file':
    case 'multiedit':
    case 'apply_patch': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `I've identified the root cause and determined the correct fix, so I'm now updating "${path}". I'll apply the changes carefully to ensure they solve the problem without affecting other parts of the system.`
        : `I've pinpointed the issue and designed a fix, so I'm applying the necessary code changes. I'll make sure the update is precise and doesn't introduce unintended side effects.`;
    }

    case 'websearch': {
      const query = firstNonEmptyValue([args.query]);
      return query
        ? `To ensure I'm working with accurate and up-to-date information, I'm searching the web for "${query}". This helps me validate assumptions, confirm best practices, or gather missing technical details before proceeding.`
        : `I'm performing a web search to gather reliable and current information that can guide my next steps and reduce uncertainty.`;
    }

    case 'webfetch': {
      const url = firstNonEmptyValue([args.url]);
      return url
        ? `I'm fetching the content from "${url}" so I can inspect the source directly. This allows me to extract precise details rather than relying on summaries or assumptions.`
        : `I'm retrieving the referenced web page to analyze its contents directly and extract any useful or relevant information.`;
    }

    case 'question':
    case 'ask_user':
      return `Before I proceed further, I need a quick clarification. This will help me avoid incorrect assumptions and ensure that the solution I provide is exactly aligned with your expectations.`;

    case 'send_user_message':
    case 'brief':
      return `I'm sending you a direct update in the transcript so you can see an important finding or progress note right away without interrupting the run.`;

    case 'structured_output':
      return `I'm returning this result as structured data so it stays stable, easy to inspect, and easier for the interface to render clearly.`;

    case 'delegate_task':
    case 'task':
      return `To handle this more efficiently, I'm delegating a focused subtask that will gather the missing context or process a specific part of the problem. This allows me to move faster while keeping the overall solution accurate.`;

    case 'batch':
      return `Instead of making multiple separate calls, I'm executing a batch of actions together to gather all the required information in one go. This improves efficiency and reduces unnecessary back-and-forth.`;

    case 'finish_task':
      return `All required steps have been completed successfully. I'm now consolidating everything and preparing a clear final summary so you can easily understand what was done and what the result is.`;

    case 'plan_exit':
      return `The entire plan has been executed step by step. At this point, I'm wrapping things up and presenting the final outcome in a structured and complete form.`;

    case 'lsp':
      return `I'm using language server capabilities to analyze the code at a deeper level—inspecting symbols, references, and relationships. This gives me a more precise understanding of how different parts of the code interact.`;

    default:
      return `I'm using the "${toolName}" tool to move forward by gathering concrete, reliable information. This step ensures that my decisions are based on actual data rather than assumptions.`;
  }
}

export function buildToolNarrationSummary(toolCalls) {
  const validCalls = (toolCalls || []).filter((toolCall) => toolCall?.function?.name);
  if (validCalls.length === 0) return '';
  if (validCalls.length === 1) return buildToolNarration(validCalls[0]);

  const firstTwo = validCalls.slice(0, 2).map(buildToolNarration);
  const combined = firstTwo.join(' ');
  if (validCalls.length === 2) return combined;

  return `${combined} I may use a couple more tools after that to finish tracing the flow cleanly.`;
}

export function getToolDisplayName(toolName) {
  if (toolName === 'bash') return 'Bash';
  if (toolName === 'read') return 'Read';
  if (toolName === 'write') return 'Write';
  if (toolName === 'edit') return 'Update';
  if (toolName === 'list') return 'List';
  if (toolName === 'glob') return 'Glob';
  if (toolName === 'grep') return 'Grep';
  if (toolName === 'question') return 'Ask';
  if (toolName === 'lsp') return 'Lsp';
  if (toolName === 'run_command') return 'Bash';
  if (toolName === 'read_file') return 'Read';
  if (toolName === 'write_file') return 'Write';
  if (toolName === 'edit_file' || toolName === 'multiedit' || toolName === 'apply_patch') return 'Update';
  if (toolName === 'list_files') return 'List';
  if (toolName === 'search_files') return 'Search';
  if (toolName === 'search_content') return 'Grep';
  if (toolName === 'ask_user') return 'Ask';
  if (toolName === 'send_user_message' || toolName === 'brief') return 'Message';
  if (toolName === 'structured_output') return 'Output';
  if (toolName === 'todowrite') return 'Update Todos';
  if (toolName === 'todoread') return 'Read Todos';
  if (toolName === 'finish_task') return 'Task';
  if (toolName === 'plan_exit') return 'Plan';
  return 'Task';
}

export function getToolPhaseLabel(toolName) {
  switch (toolName) {
    case 'read':
    case 'read_file':
      return 'Reading files';
    case 'list':
    case 'list_files':
      return 'Listing workspace';
    case 'glob':
    case 'search_files':
      return 'Searching files';
    case 'grep':
    case 'search_content':
    case 'codebase_search':
    case 'codesearch':
      return 'Searching code';
    case 'write':
    case 'write_file':
      return 'Writing files';
    case 'edit':
    case 'edit_file':
    case 'multiedit':
    case 'apply_patch':
      return 'Editing code';
    case 'bash':
    case 'run_command':
      return 'Running command';
    case 'websearch':
      return 'Searching web';
    case 'webfetch':
      return 'Fetching page';
    case 'lsp':
      return 'Inspecting symbols';
    case 'question':
    case 'ask_user':
      return 'Waiting for input';
    case 'send_user_message':
    case 'brief':
      return 'Sending message';
    case 'structured_output':
      return 'Building structured output';
    case 'delegate_task':
    case 'task':
      return 'Delegating work';
    case 'todowrite':
      return 'Updating todos';
    case 'todoread':
      return 'Reading todos';
    case 'batch':
      return 'Running tool batch';
    case 'finish_task':
      return 'Preparing summary';
    case 'plan_exit':
      return 'Finalizing plan';
    default:
      return 'Thinking';
  }
}

export function shouldInlineToolDetails(toolName) {
  switch (toolName) {
    case 'read':
    case 'read_file':
    case 'list':
    case 'list_files':
    case 'glob':
    case 'search_files':
    case 'grep':
    case 'search_content':
    case 'webfetch':
    case 'lsp':
    case 'structured_output':
      return true;
    default:
      return false;
  }
}

export function buildInlineDetailText(text, maxLines = 40) {
  const value = String(text || '').replace(/\r\n/g, '\n').trimEnd();
  if (!value) return '';

  const lines = value.split('\n');
  if (lines.length <= maxLines) return value;

  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = lines.length - maxLines;
  visibleLines.push(`... ${hiddenCount} more line${hiddenCount === 1 ? '' : 's'}`);
  return visibleLines.join('\n');
}

export function buildInlineToolDetailText(toolName, text, fullText, args = {}, maxLines = 40) {
  if (toolName === 'read' || toolName === 'read_file') {
    return firstNonEmptyValue([args.path, args.filePath]);
  }

  if (toolName === 'list' || toolName === 'list_files') {
    const value = String(fullText || '').replace(/\r\n/g, '\n').trim();
    if (!value) return '';
    const lines = value.split('\n');
    const entries = lines[0] === 'Entries:' ? lines.slice(1) : lines;
    return buildInlineDetailText(entries.join('\n'), maxLines);
  }

  if (toolName === 'glob' || toolName === 'search_files') {
    const value = String(fullText || '').replace(/\r\n/g, '\n').trim();
    if (!value) return '';
    const lines = value.split('\n');
    const entries = lines[0] === 'Found files:' ? lines.slice(1) : lines;
    return buildInlineDetailText(entries.join('\n'), maxLines);
  }

  if (toolName === 'structured_output') {
    try {
      const parsed = JSON.parse(String(fullText || '{}'));
      const payload = parsed?.structured_output ?? parsed;
      return buildInlineDetailText(JSON.stringify(payload, null, 2), maxLines);
    } catch {
      return buildInlineDetailText(fullText, maxLines);
    }
  }

  return buildInlineDetailText(fullText, maxLines);
}

export function formatToolArgs(toolName, rawArgs, argsObject) {
  const parsed = (argsObject && typeof argsObject === 'object') ? argsObject : parseToolArguments(rawArgs);
  const pick = (...values) => firstNonEmptyValue(values);

  switch (toolName) {
    case 'bash':
    case 'run_command':
      return pick(parsed.command, rawArgs);
    case 'read':
    case 'read_file':
    case 'write':
    case 'write_file':
    case 'edit':
    case 'edit_file':
    case 'multiedit':
      return pick(parsed.path, parsed.filePath, rawArgs);
    case 'apply_patch':
      return pick(parsed.path, parsed.target, 'patch');
    case 'list':
    case 'list_files':
      return pick(parsed.path, '.');
    case 'glob':
    case 'search_files':
      return pick(parsed.pattern, rawArgs);
    case 'grep':
    case 'search_content':
      return pick(parsed.query, parsed.pattern, rawArgs);
    case 'websearch':
      return pick(parsed.query, rawArgs);
    case 'webfetch':
      return pick(parsed.url, rawArgs);
    case 'todowrite':
    case 'todoread':
      return '';
    case 'question':
    case 'ask_user':
      return 'Clarification';
    case 'send_user_message':
    case 'brief':
      return pick(parsed.message, 'message');
    case 'structured_output': {
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
      return keys.length > 0 ? keys.slice(0, 3).join(', ') : 'payload';
    }
    case 'finish_task':
      return pick(parsed.message, 'done');
    case 'lsp':
      return pick(parsed.operation, 'lsp');
    default:
      return typeof rawArgs === 'string' ? rawArgs : '';
  }
}

export function ensureSpacer(linesArray) {
  if (linesArray.length === 0) return;
  if (linesArray[linesArray.length - 1]?.empty) return;
  linesArray.push({ segments: [], empty: true });
}

export function isTopLevelActivity(entry) {
  return entry?.kind === 'tool' || entry?.kind === 'command' || entry?.kind === 'chat';
}

export function findLatestLiveToolEntryId(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.kind === 'tool' || entries[i]?.kind === 'command') {
      return entries[i].id;
    }
  }

  return null;
}

export function findLatestCollapsibleId(currentActivity, messageList) {
  for (let i = currentActivity.length - 1; i >= 0; i--) {
    if (currentActivity[i]?.metadata?.isCollapsible) {
      return currentActivity[i].id;
    }
  }

  for (let i = messageList.length - 1; i >= 0; i--) {
    const msg = messageList[i];
    if (!msg?.activityLog) continue;

    for (let j = msg.activityLog.length - 1; j >= 0; j--) {
      if (msg.activityLog[j]?.metadata?.isCollapsible) {
        return msg.activityLog[j].id;
      }
    }
  }

  return null;
}

export function findLatestVisibleCollapsibleId(lineList) {
  for (let i = lineList.length - 1; i >= 0; i--) {
    if (lineList[i]?.collapsibleId) {
      return lineList[i].collapsibleId;
    }
  }

  return null;
}

export const getCharWidth = (str) => {
  if (typeof stringWidth === 'function') return stringWidth(str);
  if (stringWidth && typeof stringWidth.default === 'function') return stringWidth.default(str);
  return String(str || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
};

export function wrapText(text, maxWidth) {
  if (!text) return [];
  const lines = String(text).split('\n');
  const wrapped = [];

  for (const line of lines) {
    if (getCharWidth(line) <= maxWidth) {
      wrapped.push(line);
    } else {
      let current = line;
      while (getCharWidth(current) > maxWidth) {
        let w = 0;
        let breakIndex = 0;
        for (let i = 0; i < current.length; i++) {
          w += getCharWidth(current[i]);
          if (w > maxWidth) { breakIndex = i; break; }
        }
        let spaceIndex = current.lastIndexOf(' ', breakIndex);
        if (spaceIndex === -1 || spaceIndex === 0) spaceIndex = breakIndex;

        wrapped.push(current.slice(0, spaceIndex));
        current = current.slice(spaceIndex).trimStart();
      }
      if (current) wrapped.push(current);
    }
  }
  return wrapped;
}

export function stripThinkBlocks(text) {
  let value = String(text || '');

  while (true) {
    const startMatch = value.match(/<think>/i);
    if (!startMatch) break;

    const startIndex = startMatch.index ?? -1;
    if (startIndex < 0) break;

    const remainder = value.slice(startIndex);
    const endMatch = remainder.match(/<\/think>/i);
    if (!endMatch) {
      value = value.slice(0, startIndex);
      break;
    }

    const endIndex = startIndex + (endMatch.index ?? 0) + endMatch[0].length;
    value = `${value.slice(0, startIndex)}${value.slice(endIndex)}`;
  }

  return value.replace(/<\/?think>/gi, '');
}

export function stripInlineMarkdown(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1');
}

export function sanitizeDisplayText(text) {
  return stripSystemAndEnv(stripThinkBlocks(text))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function pushWrappedSegments(linesArray, prefixSegments, text, maxWidth, color, bold = false) {
  const prefixWidth = prefixSegments.reduce((total, segment) => total + getCharWidth(segment.text || ''), 0);
  const bodyWidth = Math.max(8, maxWidth - prefixWidth);
  const wrappedText = wrapText(text, bodyWidth);
  const continuationSegments = prefixWidth > 0 ? [{ text: ' '.repeat(prefixWidth) }] : [];

  if (wrappedText.length === 0) {
    linesArray.push({ segments: [...prefixSegments] });
    return;
  }

  wrappedText.forEach((line, index) => {
    const segments = index === 0 ? [...prefixSegments] : [...continuationSegments];
    segments.push({ text: line, color, bold });
    linesArray.push({ segments });
  });
}

export function buildFormattedLines(text, maxWidth, options = {}) {
  const {
    defaultColor = COLORS.white,
    headingColor = COLORS.orange,
    subheadingColor = COLORS.blue,
    bulletColor = COLORS.orange,
    quoteColor = COLORS.dim,
    codeColor = COLORS.code,
  } = options;

  const value = sanitizeDisplayText(text);
  if (!value) return [];

  const lines = [];
  let inCodeBlock = false;

  value.split('\n').forEach((rawLine) => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      lines.push({ segments: [], empty: true });
      return;
    }

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      pushWrappedSegments(lines, [], rawLine, maxWidth, codeColor);
      return;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const headingText = stripInlineMarkdown(trimmed.replace(/^#{1,3}\s+/, ''));
      const headingLevel = (trimmed.match(/^#+/)?.[0] || '').length;
      pushWrappedSegments(lines, [], headingText, maxWidth, headingLevel === 1 ? headingColor : subheadingColor, true);
      return;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const itemText = stripInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''));
      pushWrappedSegments(lines, [{ text: '- ', color: bulletColor }], itemText, maxWidth, defaultColor);
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const [, marker, itemText = ''] = trimmed.match(/^(\d+\.)\s+(.*)$/) || [];
      pushWrappedSegments(lines, [{ text: `${marker} `, color: bulletColor }], stripInlineMarkdown(itemText), maxWidth, defaultColor);
      return;
    }

    if (/^>\s+/.test(trimmed)) {
      const quoteText = stripInlineMarkdown(trimmed.replace(/^>\s+/, ''));
      pushWrappedSegments(lines, [{ text: '| ', color: quoteColor }], quoteText, maxWidth, quoteColor);
      return;
    }

    pushWrappedSegments(lines, [], stripInlineMarkdown(rawLine), maxWidth, defaultColor);
  });

  while (lines.length > 0 && lines[lines.length - 1]?.empty) {
    lines.pop();
  }

  return lines;
}

export function mergeSummary(previous, next) {
  return {
    ...DEFAULT_SUMMARY,
    ...(previous || {}),
    ...(next || {}),
  };
}

export function summarizeFileChange(change) {
  const path = change?.path || 'unknown';
  if (change?.status === 'error') return `Failed ${path}${change.detail ? ` - ${change.detail}` : ''}`;

  if (change?.action === 'edit' || change?.action === 'patch') {
    const adds = change?.additions !== undefined ? change.additions : (change.applied || 0);
    const rems = change?.removals !== undefined ? change.removals : 0;

    if (adds > 0 || rems > 0) {
      return `Updated ${path} with ${adds} addition${adds !== 1 ? 's' : ''} and ${rems} removal${rems !== 1 ? 's' : ''}`;
    }
    return `Updated ${path}`;
  }

  if (change?.action === 'create') return `Created ${path}`;
  if (change?.action === 'noop') return `Unchanged ${path}`;
  return `Updated ${path}`;
}
