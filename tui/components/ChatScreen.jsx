import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import stringWidth from 'string-width';
import PlanFollowupSelect from './PlanFollowupSelect.jsx';
import PlanText from './PlanText.jsx';
import { MODES, THEME } from '../constants.js';
import { createTuiReporter } from '../uiReporter.js';
import { createClient } from '../../config/apiClient.js';

const MODE_MAP = Object.fromEntries(MODES.map((mode) => [mode.value, mode]));
const DEFAULT_SUMMARY = {
  filesCreated: 0,
  filesEdited: 0,
  commandsRun: 0,
  errors: 0,
  duration: '0.0s',
  loopCount: 0,
};

// UI Specific Colors matching the reference images
const COLORS = {
  green: '#4ADE80',
  darkGreen: '#143C22',
  red: '#F87171',
  darkRed: '#451A1A',
  blue: '#60A5FA',
  orange: '#D97757',
  dim: '#71717A',
  code: '#E5C07B',
  white: '#F9FAFB',
  highlight: '#27272A' // Used for expanded blocks background
};

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function stripSystemAndEnv(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\n?/g, '')
    .replace(/<environment_details>[\s\S]*?<\/environment_details>\n?/g, '')
    .replace(/<environment_details>[\s\S]*$/g, '')
    .replace(/Implement the plan above\.\s*$/gm, '')
    .replace(/^\s*Current time:.*$/gm, '')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text, max = 96) {
  const clean = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};

  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function firstNonEmptyValue(values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function buildToolNarration(toolCall) {
  const toolName = toolCall?.function?.name || 'tool';
  const args = parseToolArguments(toolCall?.function?.arguments);

  switch (toolName) {
    case 'read':
    case 'read_file': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `I'm opening ${path} to inspect the exact code before I decide what to do next.`
        : "I'm opening the relevant file so I can inspect the exact code before making changes.";
    }
    case 'list':
    case 'list_files': {
      const path = firstNonEmptyValue([args.path, '.']);
      return `I'm listing ${path} to understand the workspace structure before I go deeper.`;
    }
    case 'glob':
    case 'search_files': {
      const pattern = firstNonEmptyValue([args.pattern]);
      return pattern
        ? `I'm searching for files matching ${pattern} so I can find the right place to inspect.`
        : "I'm searching the workspace to find the right files to inspect.";
    }
    case 'grep':
    case 'search_content': {
      const query = firstNonEmptyValue([args.query, args.pattern]);
      return query
        ? `I'm searching the codebase for ${query} so I can trace where this behavior is coming from.`
        : "I'm searching through the codebase to trace where this behavior is coming from.";
    }
    case 'bash':
    case 'run_command': {
      const command = firstNonEmptyValue([args.command]);
      return command
        ? `I'm running ${command} to verify the current state directly from the workspace.`
        : "I'm running a command to verify the current state directly from the workspace.";
    }
    case 'write':
    case 'write_file': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `I'm writing ${path} now that I know what needs to change.`
        : "I'm writing the required file changes now that I know what needs to change.";
    }
    case 'edit':
    case 'edit_file':
    case 'multiedit':
    case 'apply_patch': {
      const path = firstNonEmptyValue([args.path, args.filePath]);
      return path
        ? `I've identified the fix, and I'm updating ${path} now.`
        : "I've identified the fix, and I'm applying the code changes now.";
    }
    case 'websearch': {
      const query = firstNonEmptyValue([args.query]);
      return query
        ? `I'm searching the web for ${query} so I can verify it with current information.`
        : "I'm searching the web so I can verify this with current information.";
    }
    case 'webfetch': {
      const url = firstNonEmptyValue([args.url]);
      return url
        ? `I'm fetching ${url} so I can inspect the source directly.`
        : "I'm fetching the referenced page so I can inspect the source directly.";
    }
    case 'question':
    case 'ask_user':
      return "I need one clarification before I continue so I don't make the wrong change.";
    case 'delegate_task':
    case 'task':
      return "I'm delegating a focused subtask to gather the missing context more efficiently.";
    case 'batch':
      return "I'm running a small batch of tool calls to gather the needed context faster.";
    case 'finish_task':
      return "I've finished the work and I'm wrapping up with a final summary.";
    case 'plan_exit':
      return "I've completed the plan and I'm wrapping it up for you.";
    case 'lsp':
      return "I'm using lightweight code intelligence to inspect symbols and references in the workspace.";
    default:
      return `I'm using ${toolName} to move this forward with concrete information.`;
  }
}

function buildToolNarrationSummary(toolCalls) {
  const validCalls = (toolCalls || []).filter((toolCall) => toolCall?.function?.name);
  if (validCalls.length === 0) return '';
  if (validCalls.length === 1) return buildToolNarration(validCalls[0]);

  const firstTwo = validCalls.slice(0, 2).map(buildToolNarration);
  const combined = firstTwo.join(' ');
  if (validCalls.length === 2) return combined;

  return `${combined} I may use a couple more tools after that to finish tracing the flow cleanly.`;
}

function getToolDisplayName(toolName) {
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
  if (toolName === 'finish_task') return 'Task';
  if (toolName === 'plan_exit') return 'Plan';
  return 'Task';
}

function formatToolArgs(toolName, rawArgs, argsObject) {
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
    case 'question':
    case 'ask_user':
      return pick(parsed.question, parsed.questions?.[0]?.question, rawArgs);
    case 'finish_task':
      return pick(parsed.message, 'done');
    case 'lsp':
      return pick(parsed.operation, 'lsp');
    default:
      return typeof rawArgs === 'string' ? rawArgs : '';
  }
}

function ensureSpacer(linesArray) {
  if (linesArray.length === 0) return;
  if (linesArray[linesArray.length - 1]?.empty) return;
  linesArray.push({ segments: [], empty: true });
}

function isTopLevelActivity(entry) {
  return entry?.kind === 'tool' || entry?.kind === 'command' || entry?.kind === 'chat';
}

function findLatestLiveToolEntryId(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.kind === 'tool' || entries[i]?.kind === 'command') {
      return entries[i].id;
    }
  }

  return null;
}

function findLatestCollapsibleId(currentActivity, messageList) {
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

const getCharWidth = (str) => {
  if (typeof stringWidth === 'function') return stringWidth(str);
  if (stringWidth && typeof stringWidth.default === 'function') return stringWidth.default(str);
  return String(str || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
};

function wrapText(text, maxWidth) {
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

function mergeSummary(previous, next) {
  return {
    ...DEFAULT_SUMMARY,
    ...(previous || {}),
    ...(next || {}),
  };
}

function summarizeFileChange(change) {
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

const ChatScreen = ({ mode, model, onExit }) => {
  const { stdout } = useStdout();
  
  const [dims, setDims] = useState({
    rows: stdout.rows || 24,
    columns: stdout.columns || 80
  });

  const [messages, setMessages] = useState([
    { type: 'system', text: `DevAI Workspace initialized.`, id: 'init' },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [customBuildCmd, setCustomBuildCmd] = useState('');
  
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showQuestions, setShowQuestions] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);

  const [expandedBlocks, setExpandedBlocks] = useState(new Set());

  const [streamLabel, setStreamLabel] = useState('Waiting for input');
  const [streamResponseContent, setStreamResponseContent] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [liveTick, setLiveTick] = useState(0);

  const [pendingQuestion, setPendingQuestion] = useState(null);
  const questionResolverRef = useRef(null);
  const [planFollowup, setPlanFollowup] = useState(null);
  const planFollowupResolverRef = useRef(null);

  const clientRef = useRef(null);
  const isThinkingRef = useRef(false);
  const msgIdCounter = useRef(0);
  const currentActivityRef = useRef([]);
  const currentSummaryRef = useRef(DEFAULT_SUMMARY);
  const abortControllerRef = useRef(null);
  const lastCheckpointRef = useRef(null);

  if (!clientRef.current) {
    try {
      clientRef.current = createClient(model.apiKey);
    } catch (error) {
      clientRef.current = null;
    }
  }

  useEffect(() => {
    const handleResize = () => setDims({ rows: stdout.rows, columns: stdout.columns });
    stdout.on('resize', handleResize);
    return () => stdout.off('resize', handleResize);
  }, [stdout]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking) {
      setElapsedTime(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking) {
      setLiveTick(0);
      return undefined;
    }

    const timer = setInterval(() => {
      setLiveTick((previous) => previous + 1);
    }, 100);

    return () => clearInterval(timer);
  }, [isThinking]);

  const toggleLatestCollapsible = useCallback(() => {
    const targetId = findLatestCollapsibleId(currentActivityRef.current, messages);
    if (!targetId) return false;

    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
    return true;
  }, [messages]);

  useInput((inputChars, key) => {
    if (pendingQuestion) return;

    if (isThinkingRef.current) {
      if (key.escape || (key.ctrl && inputChars === 'c')) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          pushActivity('warning', 'Run manually interrupted by user.');
        }
      }
    } else {
      if (key.escape && showQuestions) {
        setShowQuestions(false);
        return;
      }
      
      if ((key.ctrl && inputChars === 'r') || (key.meta && inputChars === 'r') || (key.escape && inputChars === 'r')) {
        toggleLatestCollapsible();
        return;
      }

      if (key.ctrl && inputChars === 'q') {
        setShowQuestions((prev) => !prev);
        return;
      }
      
      if (!showQuestions) {
        if (key.upArrow) setScrollOffset((prev) => prev + 1);
        if (key.downArrow) setScrollOffset((prev) => Math.max(0, prev - 1));
        if (key.pageUp) setScrollOffset((prev) => prev + 10);
        if (key.pageDown) setScrollOffset((prev) => Math.max(0, prev - 10));

        if (key.ctrl && inputChars === 'p') {
          if (history.length > 0) {
            const nextIndex = Math.min(historyIndex + 1, history.length - 1);
            setHistoryIndex(nextIndex);
            setInput(history[history.length - 1 - nextIndex]);
          }
        }
        if (key.ctrl && inputChars === 'n') {
          if (historyIndex > 0) {
            const prevIndex = historyIndex - 1;
            setHistoryIndex(prevIndex);
            setInput(history[history.length - 1 - prevIndex]);
          } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            setInput('');
          }
        }
      }
    }
  });

  const nextId = useCallback(() => {
    msgIdCounter.current += 1;
    return `msg-${msgIdCounter.current}-${Date.now()}`;
  }, []);

  const updateSummary = useCallback((partial) => {
    currentSummaryRef.current = mergeSummary(currentSummaryRef.current, partial);
  }, []);

  const pushActivity = useCallback((kind, text, metadata = null) => {
    if (!text || (typeof text === 'string' && !text.trim())) return;
    
    let displayText;
    if (kind === 'chat') {
        displayText = text;
    } else {
        const message = text.replace(/\n/g, ' ').trim();
        displayText = truncate(message, 140);
    }
    
    if (!displayText) return;

    currentActivityRef.current = [
        ...currentActivityRef.current, 
        { 
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            kind, 
            text: displayText,
            metadata 
        }
    ];
    setActivityLog([...currentActivityRef.current]);
  }, []);

  const resetRunState = useCallback((label) => {
    currentActivityRef.current = [];
    currentSummaryRef.current = DEFAULT_SUMMARY;
    setStreamLabel(label);
    setStreamResponseContent('');
    setActivityLog([]);
    setScrollOffset(0);
    setCurrentTurn(1);
  }, []);

  const finishRun = useCallback(() => {
    setIsThinking(false);
    abortControllerRef.current = null;
  }, []);

  const appendMessage = useCallback((type, text, extra = {}) => {
    setMessages((previous) => [...previous, { type, text, id: nextId(), ...extra }]);
  }, [nextId]);

  const runDirectProcess = useCallback(async (command, args = [], options = {}) => {
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const commandText = [command, ...args].join(' ').trim();
      pushActivity('command', `Bash(${truncate(commandText, 60)})`);

      let stdoutText = '';
      let stderrText = '';
      const child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true,
      });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutText += text;
        text.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => {
          pushActivity('status', truncate(line, 100));
        });
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderrText += text;
        text.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => {
          pushActivity('error', truncate(line, 100));
        });
      });

      child.on('close', (code) => {
        if (code === 0) pushActivity('success', `Exit ${code}: ${truncate(commandText, 40)}`);
        else pushActivity('error', `Exit ${code}: ${truncate(commandText, 40)}`);

        resolve({
          ok: code === 0,
          status: code ?? -1,
          stdout: stdoutText,
          stderr: stderrText,
        });
      });

      child.on('error', (error) => {
        pushActivity('error', `Spawn error: ${error.message}`);
        resolve({
          ok: false,
          status: -1,
          stdout: stdoutText,
          stderr: error.message,
        });
      });
    });
  }, [pushActivity]);

  const runGitShortcut = useCallback(async (commitMessage) => {
    const message = commitMessage.trim();
    if (!message) {
      appendMessage('system', 'Usage: /git <commit message>');
      return;
    }

    setIsThinking(true);
    resetRunState('Git running');
    setScrollOffset(0);

    try {
      const statusResult = await runDirectProcess('git', ['status', '--short']);
      const pendingChanges = `${statusResult.stdout || ''}${statusResult.stderr || ''}`.trim();

      if (!pendingChanges) {
        appendMessage('system', 'There are no local changes to commit.');
        return;
      }

      const addResult = await runDirectProcess('git', ['add', '-A']);
      if (!addResult.ok) {
        appendMessage('system', 'Git add failed. Review the transcript above for the exact error.');
        return;
      }

      const commitResult = await runDirectProcess('git', ['commit', '-m', message]);
      const commitOutput = `${commitResult.stdout || ''}\n${commitResult.stderr || ''}`.trim();
      if (!commitResult.ok) {
        if (/nothing to commit/i.test(commitOutput)) {
          appendMessage('system', 'Git reported that there was nothing to commit.');
        } else {
          appendMessage('system', 'Git commit failed. Review the transcript above for the exact error.');
        }
        return;
      }

      const pushResult = await runDirectProcess('git', ['push']);
      if (!pushResult.ok) {
        appendMessage('system', 'Git push failed. Review the transcript above for the exact error.');
        return;
      }

      appendMessage('assistant', `Committed and pushed your current changes with message: ${message}`);
    } catch (error) {
      appendMessage('system', `Git shortcut failed: ${error.message}`);
    } finally {
      finishRun();
      setInput('');
    }
  }, [appendMessage, finishRun, resetRunState, runDirectProcess]);

  const runUndoShortcut = useCallback(async () => {
    const checkpoint = lastCheckpointRef.current;
    if (!checkpoint) {
      appendMessage('system', 'There is no saved AI checkpoint to undo right now.');
      return;
    }

    setIsThinking(true);
    resetRunState('Undo running');
    setScrollOffset(0);
    pushActivity('status', 'Restoring the previous workspace snapshot...');

    try {
      const { gitRestore } = await import('../../utils/git.js');
      gitRestore(checkpoint);
      lastCheckpointRef.current = null;
      appendMessage('system', 'Reverted the last AI workspace changes.');
    } catch (error) {
      appendMessage('system', `Undo failed: ${error.message}`);
    } finally {
      finishRun();
      setInput('');
    }
  }, [appendMessage, finishRun, pushActivity, resetRunState]);

  const buildReporter = useCallback((activeMode) => createTuiReporter({
    phaseHeader: ({ label }) => {
      setStreamLabel(label || `${activeMode.label} running`);
    },
    phaseStatus: ({ status, text }) => {
      if (text) setStreamLabel(text);
      if (status === 'error') pushActivity('error', text || 'Phase failed');
    },
    toolExecution: ({ toolName, args, argsObject }) => {
      const displayTool = getToolDisplayName(toolName);
      const cleanArgs = formatToolArgs(toolName, args, argsObject);
      pushActivity('tool', `${displayTool}(${truncate(cleanArgs, 50)})`);
    },
    toolResult: ({ toolName, text, fullText, isCollapsible }) => {
      const displayText = (text && text.trim()) ? text : (isCollapsible && fullText ? `${toolName || 'Result'} (${fullText.split('\n').length} lines)` : '');
      if (displayText) {
        pushActivity('status', displayText, { isCollapsible, fullText });
      }
    },
    fileChange: (change) => {
      pushActivity(
        change.status === 'error' ? 'error' : 'success',
        summarizeFileChange(change),
        { diffPreview: change.diffPreview }
      );
    },
    commandPreview: ({ command }) => {
      pushActivity('command', `Bash(${truncate(command, 60)})`);
    },
    commandResult: ({ outcome, preview, fullText, isCollapsible }) => {
      pushActivity(
        outcome === 'failed' || outcome === 'blocked' ? 'error' : 'status',
        preview || outcome,
        { isCollapsible, fullText }
      );
    },
    summary: (partial) => {
      updateSummary(partial);
      if (partial && partial.loopCount !== undefined) {
        setCurrentTurn(partial.loopCount);
      }
    },
    log: ({ level, message }) => {
      if (level === 'chat') {
        pushActivity('chat', message);
      } else {
        pushActivity(level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'status', message);
      }
    },
    askUser: ({ question, options, title }) => {
      return new Promise((resolve) => {
        let displayText = question;
        if (options && options.length > 0) {
          displayText = question + '\n\n' + options.map((opt, i) => `> ${i + 1}. ${opt}`).join('\n');
        }
        setPendingQuestion({ question: displayText, options: options || [], title: title || 'Action Required' });
        questionResolverRef.current = resolve;
      });
    },
  }), [pushActivity, updateSummary, nextId]);

  const runAskMode = useCallback(async (query, msgHistory) => {
    const client = clientRef.current;
    if (!client) return { type: 'system', text: 'API client is not configured.', id: nextId() };

    abortControllerRef.current = new AbortController();
    const chatMessages = [
      { role: 'system', content: 'You are an expert AI assistant.' },
      ...msgHistory.filter((msg) => msg.type !== 'system').map((msg) => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
      { role: 'user', content: query },
    ];

    let reply = '';
    let sawContent = false;
    try {
      const stream = await client.chat.completions.create({
        model: model.id, messages: chatMessages, temperature: model.temperature,
        top_p: model.topP, max_tokens: model.maxTokens, stream: true, ...model.extraParams,
      }, { signal: abortControllerRef.current.signal });

      for await (const chunk of stream) {
        if (chunk.choices?.[0]?.delta?.content) {
          sawContent = true;
          reply += chunk.choices[0].delta.content;
          setStreamResponseContent(reply);
        }
      }
      return { type: 'assistant', text: sawContent ? reply.trim() : 'No response.', id: nextId() };
    } catch (error) {
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted.', id: nextId() };
      return { type: 'system', text: `API Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId]);

  const runAgentMode = useCallback(async (query, msgHistory, activeMode, reporter) => {
    const client = clientRef.current;
    if (!client) return { type: 'system', text: 'API client is not configured.', id: nextId() };

    const [
      { default: runAgentPipeline }, { buildSmartContext }, { patchFile },
      { gitCheckpoint, gitRestore, gitDiscard }, { listWorkspaceEntries, searchWorkspaceFiles, searchWorkspaceContent },
      { runWorkspaceLsp }, path, fs, { parseJSON }, policyModule
    ] = await Promise.all([
      import('../../engine/agentController.js'), import('../../engine/context.js'), import('../../engine/patchEngine.js'),
      import('../../utils/git.js'), import('../../utils/fileTools.js'), import('../../utils/lspTools.js'), import('path'), import('fs'), import('../../engine/jsonParser.js'),
      import('../../config/commandPolicy.js')
        .catch(() => import('../../engine/commandPolicy.js'))
        .catch(() => ({ loadProjectCommandPolicy: () => ({ blockedExecutables: [] }) }))
    ]);

    const projectDir = process.cwd();
    const smartContext = buildSmartContext(projectDir, query, model, msgHistory);
    abortControllerRef.current = new AbortController();

    const runtime = {
      reporter, parseJSON, modelConfig: model,
      callAI: async (agentMessages, tools = undefined) => {
        let replyContent = '';
        const toolCalls = [];
        setStreamResponseContent('');

        const stream = await client.chat.completions.create({
          model: model.id, messages: agentMessages, temperature: model.temperature,
          top_p: model.topP, max_tokens: model.maxTokens, stream: true, tools, ...model.extraParams,
        }, { signal: abortControllerRef.current.signal });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            replyContent += delta.content;
            setStreamResponseContent(replyContent);
          }
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;
              if (toolCalls[index] === undefined) {
                toolCalls[index] = { id: toolCall.id || '', type: 'function', function: { name: toolCall.function?.name || '', arguments: '' } };
              } else {
                if (toolCall.id) toolCalls[index].id = toolCall.id;
                if (toolCall.function?.name) toolCalls[index].function.name = toolCall.function.name;
              }
              if (toolCall.function?.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;
            }
          }
        }
        
        const finalReply = replyContent.trim();
        if (!finalReply && toolCalls.length > 0) {
            const fallbackNarration = buildToolNarrationSummary(toolCalls.filter(Boolean));
            if (fallbackNarration) {
                reporter.log({ level: 'chat', message: fallbackNarration });
            }
        }
        setStreamResponseContent('');

        return { role: 'assistant', content: replyContent || null, tool_calls: toolCalls.length > 0 ? toolCalls.filter(Boolean) : undefined };
      },
      readFile: (filePath) => fs.readFileSync(path.resolve(projectDir, filePath.replace(/^\/+/, '')), 'utf8'),
      patchFile: (filePath, content, edits, patchOptions = {}) => patchFile(projectDir, filePath, content, edits, patchOptions),
      runCommand: async (command, cwd, commandOptions = {}) => {
        let policy = { blockedExecutables: [] };
        if (policyModule?.loadProjectCommandPolicy) {
            policy = policyModule.loadProjectCommandPolicy(projectDir) || policy;
        }

        const cmdBase = command.trim().split(/\s+/)[0];
        const isBlocked = policy.blockedExecutables?.includes(cmdBase);

        const answer = await reporter.askUser({
            title: isBlocked ? 'Bash (Policy Warning)' : 'Bash',
            question: isBlocked 
                ? `⚠️ WARNING: '${cmdBase}' is in your blockedExecutables policy!\n\nCommand: ${command}\n\nDo you want to allow it anyway?`
                : `Command: ${command}\n\nDevAI wants to execute this command.`,
            options: ['Run', 'Skip', 'Fix']
        });

        const normalizedAnswer = answer.toLowerCase();
        if (normalizedAnswer === 'skip' || answer === '2') {
            pushActivity('error', `Skipped: ${truncate(command, 60)}`);
            return { executed: false, outcome: 'skipped', stdout: '', stderr: 'User skipped this command.' };
        }
        
        if (normalizedAnswer === 'fix' || answer === '3') {
            const fixFeedback = await reporter.askUser({
                title: 'Bash - Fix',
                question: `How should DevAI fix or change this command?`,
                options: []
            });
            pushActivity('error', `Blocked: ${truncate(command, 60)}`);
            return { executed: false, outcome: 'blocked', stdout: '', stderr: `Command blocked. User feedback: ${fixFeedback}` };
        }

        pushActivity('command', `Running: ${truncate(command, 60)}`);

        const { spawn } = await import('child_process');
        const execCwd = cwd ? path.resolve(projectDir, cwd) : projectDir;

        return new Promise((resolve) => {
          let stdout = '';
          let stderr = '';
          const child = spawn(command, [], {
            cwd: execCwd,
            shell: true,
            windowsHide: true,
            timeout: commandOptions.timeout || policy.commandTimeoutMs || 300000,
          });

          child.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            const lines = text.split('\n').filter(l => l.trim());
            for (const line of lines) {
              pushActivity('status', truncate(line, 100)); // Only logs actual terminal output now
            }
          });

          child.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            const lines = text.split('\n').filter(l => l.trim());
            for (const line of lines) {
              pushActivity('error', truncate(line, 100));
            }
          });

          child.on('close', (code) => {
            if (code === 0) {
              pushActivity('success', `Exit ${code}: ${truncate(command, 40)}`);
            } else {
              pushActivity('error', `Exit ${code}: ${truncate(command, 40)}`);
            }
            resolve({ executed: true, outcome: code === 0 ? 'success' : 'failed', stdout, stderr, status: code });
          });

          child.on('error', (err) => {
            pushActivity('error', `Spawn error: ${err.message}`);
            resolve({ executed: false, outcome: 'failed', stdout, stderr: err.message, status: -1 });
          });
        });
      },
      listFiles: async (subpath = '.', depth = 2, includeHidden = false) => listWorkspaceEntries(projectDir, subpath, { depth, includeHidden }),
      searchFiles: async (pattern, searchOptions = {}) => searchWorkspaceFiles(projectDir, pattern, searchOptions),
      searchContent: async (searchText, searchOptions = {}) => searchWorkspaceContent(projectDir, searchText, searchOptions),
      lsp: async (lspOptions) => runWorkspaceLsp(projectDir, lspOptions),
      buildFreshContext: (freshQuery) => buildSmartContext(projectDir, freshQuery, model, msgHistory),
    };

    const checkpoint = gitCheckpoint(projectDir);

    try {
      let role = activeMode.value === 'planner' ? 'plan' : activeMode.value === 'orchestrator' ? 'orchestrator' : 'general';
      let execResult;
      
      if (activeMode.value === 'planner') {
        const planDir = path.join(projectDir, '.kilo', 'plans');
        if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true });
        const planFile = path.join(planDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-plan.md`);
        const planFileRelative = path.relative(projectDir, planFile);
        const reminder = `\n\n<system-reminder>\nPlan file path: ${planFileRelative}\nWrite your complete plan to this file using write_file.\n</system-reminder>\n`;
        
        execResult = await runAgentPipeline(query + reminder, smartContext, runtime, { autoPolish: false, role, reporter, extraContext: { planFile: planFileRelative } });
        
        if (checkpoint) {
          if (lastCheckpointRef.current) gitDiscard(lastCheckpointRef.current);
          lastCheckpointRef.current = checkpoint;
        }
        
        let planContent = execResult?.finalMessage?.content || '';
        try {
           const planFiles = fs.readdirSync(planDir).filter(f => f.endsWith('.md')).map(f => ({ name: f, path: path.join(planDir, f), mtime: fs.statSync(path.join(planDir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
           if (planFiles.length > 0) planContent = fs.readFileSync(planFiles[0].path, 'utf8');
        } catch (e) {}

        const cleanPlanContent = stripSystemAndEnv(planContent);
        setPlanFollowup({ planFile: planFileRelative, planContent: cleanPlanContent });
        
        const action = await new Promise((resolve) => { planFollowupResolverRef.current = resolve; });
        setPlanFollowup(null);

        if (action === 'implement') return { type: 'assistant', text: `## Plan: ${planFileRelative}\n\n${cleanPlanContent}\n\n---\n\nImplement the plan above.`, id: nextId(), planFollowup: 'implement' };
        if (action === 'new_session') return { type: 'assistant', text: `## Plan: ${planFileRelative}\n\n${cleanPlanContent}\n\n---\n\nPlan saved. Start a new session to implement.`, id: nextId(), planFollowup: 'new_session' };
        if (action === 'revise') return { type: 'assistant', text: `## Plan: ${planFileRelative}\n\n${cleanPlanContent}\n\n---\n\nPlease revise the plan based on my feedback.`, id: nextId(), planFollowup: 'revise' };
        
        return { type: 'assistant', text: `## Plan: ${planFileRelative}\n\n${cleanPlanContent}`, id: nextId(), planFollowup: 'dismissed' };
      }

      execResult = await runAgentPipeline(query, smartContext, runtime, { autoPolish: activeMode.value === 'polish', role, reporter });
      if (checkpoint) {
        if (lastCheckpointRef.current) gitDiscard(lastCheckpointRef.current);
        lastCheckpointRef.current = checkpoint;
      }

      return { type: 'assistant', text: typeof execResult.finalMessage.content === 'string' ? execResult.finalMessage.content : 'Agent completed.', id: nextId() };
    } catch (error) {
      if (checkpoint) gitRestore(checkpoint);
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted.', id: nextId() };
      return { type: 'system', text: `Agent Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId]);

  const executeHandler = useCallback(async (query, activeMode = mode) => {
    setIsThinking(true);
    resetRunState(`${activeMode.label} running`);
    const reporter = buildReporter(activeMode);
    let resultMsg;

    try {
      const msgSnapshot = [...messages];
      if (activeMode.value === 'ask') resultMsg = await runAskMode(query, msgSnapshot);
      else resultMsg = await runAgentMode(query, msgSnapshot, activeMode, reporter);

      if (resultMsg && currentActivityRef.current.length > 0) {
          resultMsg.activityLog = [...currentActivityRef.current];
      }

      if (resultMsg?.planFollowup === 'implement') {
        setMessages((previous) => [...previous, resultMsg]);
        const implMode = { ...activeMode, label: 'Code', value: 'agent' };
        const implReporter = buildReporter(implMode);
        const implResult = await runAgentMode(`Implement the plan above.`, [...msgSnapshot, resultMsg], implMode, implReporter);
        if (implResult) implResult.activityLog = [...currentActivityRef.current];
        resultMsg = implResult;
      }

      if (resultMsg?.planFollowup === 'revise') {
        setMessages((previous) => [...previous, resultMsg]);
        const reviseResult = await runAgentMode(resultMsg.text, [...msgSnapshot, resultMsg], activeMode, reporter);
        if (reviseResult) reviseResult.activityLog = [...currentActivityRef.current];
        resultMsg = reviseResult;
      }
    } catch (error) {
      resultMsg = { type: 'system', text: `Error: ${error.message}`, id: nextId() };
    }

    setMessages((previous) => [...previous, resultMsg]);
    finishRun();
    setInput('');
  }, [mode, messages, nextId, buildReporter, finishRun, resetRunState, runAgentMode, runAskMode]);

  const resolveBuildCommand = useCallback(async (explicitCommand = '') => {
    const requested = explicitCommand.trim();
    if (requested) {
      setCustomBuildCmd(requested);
      return requested;
    }

    if (customBuildCmd.trim()) {
      return customBuildCmd.trim();
    }

    const { detectBuildCommand } = await import('../../engine/context.js');
    return detectBuildCommand(process.cwd(), null);
  }, [customBuildCmd]);

  const handleSubmit = useCallback(async (value) => {
    if (pendingQuestion && questionResolverRef.current) {
      const trimmed = value.trim();
      if (!trimmed) return;
      const options = typeof pendingQuestion === 'object' && pendingQuestion.options ? pendingQuestion.options : [];
      const optionMatch = trimmed.match(/^(\d+)$/);
      
      let answer = trimmed;
      if (optionMatch && options.length > 0) {
        const idx = parseInt(optionMatch[1], 10) - 1;
        if (idx >= 0 && idx < options.length) answer = options[idx];
      } else if (options.length > 0) {
        const lowerInput = trimmed.toLowerCase();
        for (const opt of options) {
          if (opt.toLowerCase() === lowerInput) {
            answer = opt;
            break;
          }
        }
      }
      
      pushActivity('success', `Answer: ${answer}`); // Native inline display
      
      const resolver = questionResolverRef.current;
      questionResolverRef.current = null;
      setPendingQuestion(null);
      setInput('');
      resolver(answer);
      return;
    }

    if (isThinkingRef.current) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);

    if (trimmed.toLowerCase() === '/exit' || trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === '/quit') {
      onExit();
      return;
    }

    if (trimmed.toLowerCase() === '/clear') {
      setMessages([{ type: 'system', text: 'Chat history cleared.', id: nextId() }]);
      setInput('');
      setScrollOffset(0);
      return;
    }

    if (trimmed.toLowerCase() === '/expand' || trimmed.toLowerCase() === '/collapse' || trimmed.toLowerCase() === '/toggle') {
      toggleLatestCollapsible();
      setInput('');
      return;
    }

    const normalizedTrimmed = trimmed.toLowerCase();
    const canUndoWithShortcut = normalizedTrimmed === 'n' && !!lastCheckpointRef.current;
    if (normalizedTrimmed === 'undo' || canUndoWithShortcut) {
      setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
      setInput('');
      await runUndoShortcut();
      return;
    }

    if (trimmed.startsWith('/git')) {
      const commitMessage = trimmed.slice(4).trim();
      setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
      setInput('');
      await runGitShortcut(commitMessage);
      return;
    }

    let activeMode = mode;
    let query = trimmed;
    if (trimmed.startsWith('/plan')) { activeMode = MODE_MAP.planner; query = trimmed.slice(5).trim() || 'Create a plan.'; }
    else if (trimmed.startsWith('/polish')) { activeMode = MODE_MAP.polish; query = trimmed.slice(7).trim() || 'Improve code.'; }
    else if (trimmed.startsWith('/agent')) { activeMode = MODE_MAP.agent; query = trimmed.slice(6).trim(); }
    else if (trimmed.startsWith('/ask')) { activeMode = MODE_MAP.ask; query = trimmed.slice(4).trim(); }
    else if (trimmed.startsWith('/build')) {
      const requestedBuildCommand = trimmed.slice(6).trim();
      const buildCommand = await resolveBuildCommand(requestedBuildCommand);

      setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
      setInput('');
      setScrollOffset(0);

      if (!buildCommand) {
        appendMessage('system', 'I could not detect a build or test command here. Use `/build <command>` to set one for this session.');
        return;
      }

      activeMode = { value: 'build', label: 'Build' };
      query = `Run the workspace build or test command \`${buildCommand}\` from the project root. Start by executing exactly that command. If it fails, inspect the output, fix the underlying issue in the code or workspace, and rerun the same command until it succeeds or you hit a real blocker. Keep the final response focused on what changed and whether the build passed.`;
      executeHandler(query, activeMode);
      return;
    }

    setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
    setInput('');
    setScrollOffset(0);
    executeHandler(query, activeMode);
  }, [appendMessage, executeHandler, mode, nextId, onExit, pendingQuestion, pushActivity, resolveBuildCommand, runGitShortcut, runUndoShortcut, toggleLatestCollapsible]);

  const handleQuestionSelect = useCallback((item) => {
    setShowQuestions(false);
    if (item.value !== 'CANCEL' && item.value !== 'NONE') handleSubmit(item.value);
  }, [handleSubmit]);

  const questionItems = useMemo(() => {
    const items = [];
    [...new Set(history)].reverse().forEach((h, i) => items.push({ label: `[History]  ${truncate(h, 60)}`, value: h, key: `hist-${i}` }));
    if (items.length === 0) items.push({ label: 'No history available.', value: 'NONE', key: 'none' });
    items.push({ label: '← Back to typing (Esc)', value: 'CANCEL', key: 'cancel' });
    return items;
  }, [history]);

  const renderActivityEntry = (entry, linesArray, maxW, liveRenderState = {}) => {
      // INTERLEAVING RENDERER: Renders pure conversational text elegantly inline
      if (entry.kind === 'chat') {
          let inCodeBlock = false;
          wrapText(entry.text, maxW - 2).forEach((l, i) => {
              if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
              let color = inCodeBlock ? COLORS.code : COLORS.white;
              if (i === 0) {
                  linesArray.push({ segments: [{ text: '● ', color: COLORS.white }, { text: l, color }] });
              } else {
                  linesArray.push({ segments: [{ text: '  ' }, { text: l, color }] });
              }
          });
          return;
      }

      const isSub = entry.kind === 'status' || entry.kind === 'success' || entry.kind === 'error';
      const isTool = entry.kind === 'tool' || entry.kind === 'command';
      const isExpanded = expandedBlocks.has(entry.id);
      const isActiveTool = isTool && liveRenderState.activeToolEntryId === entry.id;
      const icon = isSub ? '  └ ' : '● ';
      
      let mainText = entry.text;
      let hintText = null;

      if (entry.metadata?.isCollapsible && !isExpanded) {
          hintText = { text: ' (ctrl+r / alt+r / /expand)', color: COLORS.dim };
      }

      wrapText(`${icon}${mainText}`, maxW).forEach((l, i) => {
          if (i === 0) {
              if (isTool) {
                  const rawText = l.slice(2);
                  const match = rawText.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
                  const toolIcon = isActiveTool
                    ? { text: `${liveRenderState.spinnerFrame || '*'} `, color: COLORS.orange }
                    : null;
                  if (isActiveTool) {
                      if (match) {
                          linesArray.push({ segments: [
                              toolIcon,
                              { text: match[1], bold: true, color: COLORS.white },
                              { text: '(', color: COLORS.dim },
                              { text: match[2], color: COLORS.dim },
                              { text: ')', color: COLORS.dim }
                          ]});
                      } else {
                          linesArray.push({ segments: [toolIcon, { text: rawText, bold: true, color: COLORS.white }] });
                      }
                      return;
                  }
                  if (match) {
                      linesArray.push({ segments: [
                          { text: '● ', color: COLORS.green },
                          { text: match[1], bold: true, color: COLORS.white },
                          { text: '(', color: COLORS.dim },
                          { text: match[2], color: COLORS.dim },
                          { text: ')', color: COLORS.dim }
                      ]});
                  } else {
                      linesArray.push({ segments: [{ text: '● ', color: COLORS.green }, { text: rawText, bold: true, color: COLORS.white }] });
                  }
              } else if (isSub) {
                  const textColor = entry.kind === 'error' ? COLORS.red : COLORS.white;
                  const segs = [
                      { text: '  └ ', color: COLORS.dim }, 
                      { text: l.slice(4), color: textColor }
                  ];
                  if (hintText) segs.push(hintText);
                  linesArray.push({ segments: segs });
              } else {
                  linesArray.push({ segments: [{ text: l, color: COLORS.dim }] });
              }
          } else {
              linesArray.push({ segments: [{ text: isSub ? `    ${l.trimStart()}` : `  ${l.trimStart()}`, color: COLORS.dim }] });
          }
      });

      if (entry.metadata?.isCollapsible && isExpanded && entry.metadata.fullText) {
          wrapText(entry.metadata.fullText, maxW - 4).forEach(el => {
              linesArray.push({ segments: [
                  { text: '      ', color: COLORS.dim },
                  { text: el, color: COLORS.white, backgroundColor: COLORS.highlight }
              ]});
          });
      }

      if (entry.metadata?.diffPreview && entry.metadata.diffPreview.length > 0) {
          entry.metadata.diffPreview.forEach(diff => {
              let bgColor = undefined;
              let fgColor = COLORS.white;
              
              if (diff.type === 'removed') { 
                  bgColor = COLORS.darkRed; 
                  fgColor = COLORS.red; 
              } else if (diff.type === 'added') { 
                  bgColor = COLORS.darkGreen; 
                  fgColor = COLORS.green; 
              }

              const lineNumStr = (diff.lineNum || ' ').padEnd(5, ' ');
              
              linesArray.push({ segments: [
                  { text: '      ' },
                  { text: lineNumStr, color: COLORS.dim },
                  { text: diff.text, color: fgColor, backgroundColor: bgColor }
              ]});
          });
      }
  };

  const renderActivityClusters = (entries, linesArray, maxW, liveRenderState = {}) => {
      if (!entries || entries.length === 0) return;

      const clusters = [];
      let currentCluster = [];

      entries.forEach((entry) => {
          if (isTopLevelActivity(entry)) {
              if (currentCluster.length > 0) clusters.push(currentCluster);
              currentCluster = [entry];
          } else if (currentCluster.length > 0) {
              currentCluster.push(entry);
          } else {
              currentCluster = [entry];
          }
      });

      if (currentCluster.length > 0) clusters.push(currentCluster);

      clusters.forEach((cluster, index) => {
          if (index > 0) ensureSpacer(linesArray);
          cluster.forEach((entry) => renderActivityEntry(entry, linesArray, maxW, liveRenderState));
      });
  };

  const spinnerFrame = SPINNER_FRAMES[liveTick % SPINNER_FRAMES.length];
  const showStreamingCursor = liveTick % 2 === 0;
  const activeToolEntryId = useMemo(() => (
    isThinking ? findLatestLiveToolEntryId(activityLog) : null
  ), [activityLog, isThinking]);

  const maxLineWidth = Math.max(20, dims.columns - 4);
  const allLines = useMemo(() => {
    let lines = [];

    const addTextWrapped = (text, defaultColor = COLORS.white, isBold = false) => {
       wrapText(text, maxLineWidth).forEach(l => {
           lines.push({ segments: [{ text: l, color: defaultColor, bold: isBold }] });
       });
    };

    messages.forEach((msg) => {
      if (msg.type === 'system') {
         if (msg.id !== 'init') {
            addTextWrapped(msg.text, COLORS.dim);
            lines.push({ segments: [], empty: true });
         }
      } else if (msg.type === 'user') {
         addTextWrapped(`> ${msg.text}`, COLORS.white, true);
         lines.push({ segments: [], empty: true });
      } else {
         if (msg.activityLog && msg.activityLog.length > 0) {
             renderActivityClusters(msg.activityLog, lines, maxLineWidth);
             ensureSpacer(lines);
         }

         if (msg.planFollowup && msg.planFollowup !== 'none') {
             const planContent = msg.text.replace(/^## Plan: .*\n\n/, '').replace(/\n\n---\n\n[\s\S]*$/, '').trim();
             lines.push({ segments: [{ text: '✓ PLAN COMPLETE', color: COLORS.orange, bold: true }] });
             addTextWrapped(planContent, COLORS.white);
             if (msg.planFollowup === 'implement') lines.push({ segments: [{ text: '→ Implementing in this session...', color: COLORS.green }] });
             else if (msg.planFollowup === 'new_session') lines.push({ segments: [{ text: '✦ Plan saved for next session.', color: COLORS.dim }] });
             lines.push({ segments: [], empty: true });
         } else if (msg.text) {
             // Only render msg.text if it's not already printed perfectly at the end of activityLog
             let isDuplicate = false;
             if (msg.activityLog && msg.activityLog.length > 0) {
                 const lastChat = msg.activityLog.slice().reverse().find(a => a.kind === 'chat');
                 if (lastChat && lastChat.text === msg.text) isDuplicate = true;
             }
             if (!isDuplicate && msg.text !== 'Agent completed.') {
                 let inCodeBlock = false;
                 const wrappedLines = [];
                 
                 wrapText(msg.text, maxLineWidth - 2).forEach(l => {
                     if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
                     let color = inCodeBlock ? COLORS.code : COLORS.white;
                     wrappedLines.push({ text: l, color });
                 });
    
                 wrappedLines.forEach((wl, i) => {
                     if (i === 0) {
                         lines.push({ segments: [
                             { text: '● ', color: COLORS.white }, 
                             { text: wl.text, color: wl.color }
                         ]});
                     } else {
                         lines.push({ segments: [
                             { text: '  ' }, 
                             { text: wl.text, color: wl.color }
                         ]});
                     }
                 });
                 lines.push({ segments: [], empty: true });
             }
         }
      }
    });

    if (isThinking) {
       renderActivityClusters(activityLog, lines, maxLineWidth, { activeToolEntryId, spinnerFrame });

       if (streamResponseContent) {
           lines.push({ segments: [], empty: true });
           let inCodeBlock = false;
           const wrappedLines = [];
           
           wrapText(streamResponseContent, maxLineWidth - 2).forEach(l => {
               if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
               wrappedLines.push({ text: l, color: inCodeBlock ? COLORS.code : COLORS.white });
           });
           
           wrappedLines.forEach((wl, i) => {
               if (i === 0) {
                   lines.push({ segments: [{ text: '● ', color: COLORS.white }, { text: wl.text, color: wl.color }] });
               } else {
                   lines.push({ segments: [{ text: '  ' }, { text: wl.text, color: wl.color }] });
               }
            });
            if (wrappedLines.length > 0 && lines.length > 0) {
                const lastStreamingLine = lines[lines.length - 1];
                if (lastStreamingLine?.segments) {
                    lastStreamingLine.segments.push({ text: showStreamingCursor ? '▋' : ' ', color: COLORS.dim });
                }
            }
        }
    }

    while (lines.length > 0 && lines[lines.length - 1].empty) {
        lines.pop();
    }
    return lines;
  }, [messages, isThinking, activityLog, streamResponseContent, maxLineWidth, expandedBlocks, activeToolEntryId, showStreamingCursor, spinnerFrame]);

  let uiReservedLines = 4; 
  if (isThinking) uiReservedLines += 2;
  
  if (pendingQuestion) {
      const qStr = typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question;
      let qLinesCount = 0;
      qStr.split('\n').forEach(line => {
        qLinesCount += wrapText(line, dims.columns - 4).length;
      });
      uiReservedLines += 3 + qLinesCount;
  }
  if (planFollowup) uiReservedLines += 5;

  const chatLinesAvailable = Math.max(5, dims.rows - uiReservedLines);
  const maxScroll = Math.max(0, allLines.length - chatLinesAvailable);
  const clampedScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const startIndex = Math.max(0, allLines.length - chatLinesAvailable - clampedScroll);
  const visibleLines = allLines.slice(startIndex, startIndex + chatLinesAvailable);

  if (showQuestions) {
    return (
      <Box flexDirection="column" height={dims.rows} width="100%" alignItems="center" justifyContent="center" paddingX={1}>
        <Box borderStyle="round" borderColor={COLORS.dim} padding={2} flexDirection="column" width={72}>
          <Text color={COLORS.blue} bold marginBottom={1}>Select a Question</Text>
          <Box flexDirection="column" paddingX={2}>
            <SelectInput
              items={questionItems}
              onSelect={handleQuestionSelect}
              indicatorComponent={({ isSelected }) => <Text color={isSelected ? COLORS.blue : COLORS.dim}>{isSelected ? '❯ ' : '  '}</Text>}
              itemComponent={({ isSelected, label }) => <Text color={isSelected ? COLORS.white : COLORS.dim} bold={isSelected}>{label}</Text>}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={dims.rows} width="100%" paddingX={1}>
      
      {scrollOffset > 0 && (
        <Box flexDirection="row" paddingX={1} paddingBottom={1} justifyContent="flex-end">
           <Text color={COLORS.dim} bold>↑ Scrolled {clampedScroll} ↑</Text>
        </Box>
      )}

      {/* Scrollable Log History Area */}
      <Box flexGrow={1} flexDirection="column" overflowY="hidden" paddingX={1} paddingTop={0}>
        {visibleLines.map((line, index) => (
          <Box key={index} flexDirection="row">
             {line.empty ? (
               <Text> </Text>
             ) : null}
             {line.segments?.map((seg, sIdx) => (
                <Text 
                  key={sIdx} 
                 color={seg.color} 
                 backgroundColor={seg.backgroundColor} 
                 bold={seg.bold}
               >
                 {seg.text}
               </Text>
             ))}
          </Box>
        ))}
      </Box>

      {/* Live Status Tracker */}
      {isThinking && (
        <Box flexDirection="row" paddingX={1} marginBottom={1} marginTop={1}>
           <Text color={COLORS.orange}>{spinnerFrame} {streamLabel}... </Text>
           <Text color={COLORS.dim}>({elapsedTime}s · esc to interrupt)</Text>
        </Box>
      )}

      {/* Permission Box overlay */}
      {pendingQuestion && (
        <Box flexDirection="column" borderStyle="round" borderColor={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} paddingX={1} marginX={1} marginBottom={1}>
          <Text color={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} bold>{pendingQuestion.title || 'Action Required'}</Text>
          <Box flexDirection="column" marginTop={1} marginBottom={0}>
            {(typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question).split('\n').map((line, i) => {
              const isOption = line.trim().startsWith('>');
              return <Text key={i} color={isOption ? COLORS.white : COLORS.dim} bold={isOption}>{line}</Text>;
            })}
          </Box>
        </Box>
      )}

      {/* Plan Selection Overlay */}
      {planFollowup && !isThinking && (
        <Box flexDirection="column" marginX={1} marginBottom={1}>
          <PlanFollowupSelect
            planFile={planFollowup.planFile}
            onSelect={(action) => {
              if (planFollowupResolverRef.current) {
                const resolver = planFollowupResolverRef.current;
                planFollowupResolverRef.current = null;
                resolver(action);
              }
            }}
          />
        </Box>
      )}

      {/* Main Input Box (Rounded like the reference) */}
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={COLORS.dim} paddingX={1} flexDirection="row">
          <Box marginRight={1}>
            <Text color={COLORS.white} bold>{'>'}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              value={input}
              onChange={(val) => {
                if (!isThinking || pendingQuestion) setInput(val);
              }}
              onSubmit={handleSubmit}
              placeholder={pendingQuestion ? (pendingQuestion.options?.length > 0 ? 'Type a number or your answer...' : 'Type your answer...') : ''}
              focus={!isThinking || pendingQuestion}
              showCursor
            />
          </Box>
        </Box>
      </Box>

      {/* Footer Minimal Strips */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text color={COLORS.dim}>? for shortcuts</Text>
      </Box>

    </Box>
  );
};

export default ChatScreen;
