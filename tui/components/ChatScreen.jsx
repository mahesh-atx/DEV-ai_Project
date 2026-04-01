import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import stringWidth from 'string-width';
import StreamingPanel from './StreamingPanel.jsx';
import { MODES, THEME } from '../constants.js';
import { createTuiReporter } from '../uiReporter.js';
import { createClient } from '../../config/apiClient.js';

const THINKING_FRAMES = ['-', '\\', '|', '/'];
const MODE_MAP = Object.fromEntries(MODES.map((mode) => [mode.value, mode]));
const DEFAULT_SUMMARY = {
  filesCreated: 0,
  filesEdited: 0,
  commandsRun: 0,
  errors: 0,
  duration: '0.0s',
  loopCount: 0,
};

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function truncate(text, max = 96) {
  const clean = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

// Robust width calculator that falls back if string-width isn't fully loaded
const getCharWidth = (str) => {
  if (typeof stringWidth === 'function') return stringWidth(str);
  if (stringWidth && typeof stringWidth.default === 'function') return stringWidth.default(str);
  return String(str || '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
};

// Custom word wrapper to break text into strict terminal lines
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

  if (change?.status === 'error') {
    return `${path} failed${change.detail ? ` - ${change.detail}` : ''}`;
  }

  if (change?.action === 'create') return `${path} created`;
  if (change?.action === 'edit') return `${path} edited (${change.applied || 0} applied${change.failed ? `, ${change.failed} failed` : ''})`;
  if (change?.action === 'patch') return `${path} patched`;
  if (change?.action === 'noop') return `${path} unchanged`;
  return `${path} updated`;
}

function statusTone(entry) {
  if (!entry) return THEME.dim;
  if (entry.kind === 'error') return THEME.error;
  if (entry.kind === 'success') return THEME.success;
  if (entry.kind === 'warning') return THEME.warning;
  if (entry.kind === 'tool' || entry.kind === 'command') return THEME.accent;
  return THEME.dim;
}

const ChatScreen = ({ mode, model, onExit }) => {
  const { stdout } = useStdout();
  
  // Track terminal dimensions dynamically
  const [dims, setDims] = useState({
    rows: stdout.rows || 24,
    columns: stdout.columns || 80
  });

  const colLeft = Math.max(56, Math.floor(dims.columns * 0.68) - 2);
  const colRight = Math.max(26, dims.columns - colLeft - 4);

  const [messages, setMessages] = useState([
    { type: 'system', text: `DevAI initialized.\nMode: ${mode.label} | Model: ${model.name}`, id: 'init' },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkFrame, setThinkFrame] = useState(0);
  const [msgCount, setMsgCount] = useState(0);
  const [sessionTime, setSessionTime] = useState('0:00');
  const [customBuildCmd, setCustomBuildCmd] = useState('');
  
  // Input History & Questions Box
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showQuestions, setShowQuestions] = useState(false);
  
  // Track line scroll offset rather than message scroll offset
  const [scrollOffset, setScrollOffset] = useState(0);

  const [streamLabel, setStreamLabel] = useState('Waiting for input');
  const [streamPercent, setStreamPercent] = useState(0);
  const [streamChars, setStreamChars] = useState(0);
  const [streamThinkingChars, setStreamThinkingChars] = useState(0);
  const [streamThinkingContent, setStreamThinkingContent] = useState('');
  const [streamResponseContent, setStreamResponseContent] = useState('');
  const [streamFiles, setStreamFiles] = useState([]);
  const [streamElapsed, setStreamElapsed] = useState('0.0');
  const [activityLog, setActivityLog] = useState([]);
  const [currentSummary, setCurrentSummary] = useState(DEFAULT_SUMMARY);

  const [lastSummary, setLastSummary] = useState(null);
  const [lastFiles, setLastFiles] = useState([]);
  const [lastActivityLog, setLastActivityLog] = useState([]);
  const [lastStatus, setLastStatus] = useState('Ready');

  // ask_user tool state
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const questionResolverRef = useRef(null);

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const clientRef = useRef(null);
  const isThinkingRef = useRef(false);
  const msgIdCounter = useRef(0);
  const sessionStartRef = useRef(Date.now());
  const currentFilesRef = useRef([]);
  const currentActivityRef = useRef([]);
  const currentSummaryRef = useRef(DEFAULT_SUMMARY);
  const abortControllerRef = useRef(null);

  if (!clientRef.current) {
    try {
      clientRef.current = createClient(model.apiKey);
    } catch (error) {
      clientRef.current = null;
    }
  }

  // Handle Terminal Resize Events
  useEffect(() => {
    const handleResize = () => {
      setDims({ rows: stdout.rows, columns: stdout.columns });
    };
    stdout.on('resize', handleResize);
    return () => stdout.off('resize', handleResize);
  }, [stdout]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      const minutes = Math.floor(diff / 60);
      const seconds = diff % 60;
      setSessionTime(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isThinking) return undefined;
    const timer = setInterval(() => {
      setThinkFrame((frame) => (frame + 1) % THINKING_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [isThinking]);

  // Global input interceptor for Interruptions, Scrolling, History, and Questions Box
  useInput((inputChars, key) => {
    // Allow input when there's a pending agent question
    if (pendingQuestion) {
      return;
    }

    if (isThinkingRef.current) {
      // Cancel execution
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

      if (key.ctrl && inputChars === 'q') {
        setShowQuestions((prev) => !prev);
        return;
      }

      if (!showQuestions) {
        // 1. Scrolling controls 
        if (key.upArrow) setScrollOffset((prev) => prev + 1);
        if (key.downArrow) setScrollOffset((prev) => Math.max(0, prev - 1));
        if (key.pageUp) setScrollOffset((prev) => prev + 10);
        if (key.pageDown) setScrollOffset((prev) => Math.max(0, prev - 10));

        // 2. Input History Navigation (Inline scrolling)
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

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const diff = Date.now() - startTimeRef.current;
      setStreamElapsed((diff / 1000).toFixed(1));
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updateSummary = useCallback((partial) => {
    currentSummaryRef.current = mergeSummary(currentSummaryRef.current, partial);
    setCurrentSummary(currentSummaryRef.current);
  }, []);

  const pushActivity = useCallback((kind, text) => {
    const message = truncate(text, 110);
    if (!message) return;
    currentActivityRef.current = [...currentActivityRef.current, { kind, text: message }].slice(-20);
    setActivityLog([...currentActivityRef.current]);
  }, []);

  const registerFile = useCallback((filePath) => {
    if (!filePath) return;
    if (currentFilesRef.current.includes(filePath)) return;
    currentFilesRef.current = [...currentFilesRef.current, filePath].slice(-8);
    setStreamFiles([...currentFilesRef.current]);
  }, []);

  const resetRunState = useCallback((label) => {
    currentFilesRef.current = [];
    currentActivityRef.current = [];
    currentSummaryRef.current = DEFAULT_SUMMARY;
    setStreamLabel(label);
    setStreamPercent(0);
    setStreamChars(0);
    setStreamThinkingChars(0);
    setStreamThinkingContent('');
    setStreamResponseContent('');
    setStreamFiles([]);
    setStreamElapsed('0.0');
    setActivityLog([]);
    setCurrentSummary(DEFAULT_SUMMARY);
    setScrollOffset(0);
  }, []);

  const finishRun = useCallback((resultMsg) => {
    stopTimer();
    setIsThinking(false);
    setLastFiles(currentFilesRef.current);
    setLastActivityLog(currentActivityRef.current);
    
    abortControllerRef.current = null;

    const summary = currentSummaryRef.current;
    const hasSummaryData = summary.filesCreated || summary.filesEdited || summary.commandsRun || summary.errors || summary.loopCount;
    setLastSummary(hasSummaryData ? summary : null);

    if (resultMsg?.type === 'system' && /error|abort/i.test(resultMsg.text || '')) {
      setLastStatus('Error/Aborted');
    } else if (hasSummaryData) {
      setLastStatus(summary.errors > 0 ? 'Completed with issues' : 'Completed');
    } else {
      setLastStatus('Ready');
    }
  }, [stopTimer]);

  const buildReporter = useCallback((activeMode) => createTuiReporter({
    phaseHeader: ({ label }) => {
      setStreamLabel(label || `${activeMode.label} running`);
      pushActivity('status', label || `${activeMode.label} running`);
    },
    phaseStatus: ({ status, text }) => {
      if (text) setStreamLabel(text);
      if (status === 'error') pushActivity('error', text || 'Phase failed');
      if (status === 'success') pushActivity('success', text || 'Phase finished');
    },
    toolExecution: ({ toolName, args }) => {
      pushActivity('tool', `${toolName}${args ? ` -> ${args}` : ''}`);
    },
    toolResult: ({ text }) => {
      pushActivity('status', text);
    },
    fileChange: (change) => {
      registerFile(change.path);
      pushActivity(change.status === 'error' ? 'error' : 'success', summarizeFileChange(change));
    },
    commandPreview: ({ command, reason }) => {
      pushActivity('command', `${command}${reason ? ` - ${truncate(reason, 42)}` : ''}`);
    },
    commandResult: ({ command, outcome, preview }) => {
      const line = `${command}: ${outcome}${preview ? ` - ${truncate(preview, 56)}` : ''}`;
      pushActivity(outcome === 'failed' || outcome === 'blocked' ? 'error' : 'status', line);
    },
    summary: (partial) => {
      updateSummary(partial);
    },
    log: ({ level, message }) => {
      pushActivity(level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'status', message);
    },
    askUser: ({ question }) => {
      return new Promise((resolve) => {
        pushActivity('status', `Agent asks: ${question}`);
        setPendingQuestion(question);
        questionResolverRef.current = resolve;
      });
    },
  }), [pushActivity, registerFile, updateSummary]);

  const runAskMode = useCallback(async (query, msgHistory) => {
    const client = clientRef.current;
    if (!client) {
      return { type: 'system', text: 'API client is not configured. Check your environment variables.', id: nextId() };
    }

    startTimer();
    abortControllerRef.current = new AbortController();

    const chatMessages = [
      { role: 'system', content: 'You are an expert AI assistant. If code is requested, provide clean, production-ready code. Maintain context of the conversation.' },
      ...msgHistory.filter((msg) => msg.type !== 'system').map((msg) => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
      { role: 'user', content: query },
    ];

    let reply = '';
    let thinkingChars = 0;
    let sawContent = false;

    try {
      const stream = await client.chat.completions.create({
        model: model.id,
        messages: chatMessages,
        temperature: model.temperature,
        top_p: model.topP,
        max_tokens: model.maxTokens,
        stream: true,
        ...model.extraParams,
      }, { signal: abortControllerRef.current.signal });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          thinkingChars += delta.reasoning_content.length;
          setStreamThinkingChars(thinkingChars);
          setStreamThinkingContent((prev) => prev + delta.reasoning_content);
          setStreamPercent((value) => Math.min(value + 2, 94));
        }
        if (delta?.content) {
          sawContent = true;
          reply += delta.content;
          setStreamChars(reply.length);
          setStreamResponseContent((prev) => prev + delta.content);
          setStreamPercent((value) => Math.min(Math.max(value, 12) + 1, 99));
        }
      }

      setStreamPercent(100);
      updateSummary({
        duration: `${((Date.now() - startTimeRef.current) / 1000).toFixed(1)}s`,
      });

      return {
        type: 'assistant',
        text: sawContent ? reply.trim() : 'No response received from model.',
        id: nextId(),
      };
    } catch (error) {
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted by user.', id: nextId() };
      return { type: 'system', text: `API Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId, startTimer, updateSummary]);

  const runStandardMode = useCallback(async (query, msgHistory, reporter) => {
    const client = clientRef.current;
    if (!client) {
      return { type: 'system', text: 'API client is not configured. Check your environment variables.', id: nextId() };
    }

    const [
      { detectProjectType, buildSmartContext },
      { selectPrompt },
      { parseJSON },
      { patchFile },
      { runCommands },
      fs,
      path,
    ] = await Promise.all([
      import('../../engine/context.js'),
      import('../../prompts/index.js'),
      import('../../engine/jsonParser.js'),
      import('../../engine/patchEngine.js'),
      import('../../engine/commandExecutor.js'),
      import('fs'),
      import('path'),
    ]);

    const projectDir = process.cwd();
    const projectType = detectProjectType(projectDir);
    const smartContext = buildSmartContext(projectDir, query, model, msgHistory);
    const selectedPrompt = selectPrompt(query, projectType);
    const apiMessages = [
      { role: 'system', content: selectedPrompt },
      ...msgHistory.filter((msg) => msg.type !== 'system').map((msg) => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
      {
        role: 'user',
        content: `User request: ${query}\nProject: ${projectType}\nProject folder: ${projectDir}\n\n${smartContext}`,
      },
    ];

    startTimer();
    abortControllerRef.current = new AbortController();
    setStreamLabel('Generating response');

    let reply = '';
    let thinkingChars = 0;
    let searchIndex = 0;
    const pathRegex = /"path"\s*:\s*"([^"]+)"/g;

    try {
      const stream = await client.chat.completions.create({
        model: model.id,
        messages: apiMessages,
        temperature: model.temperature,
        top_p: model.topP,
        max_tokens: model.maxTokens,
        stream: true,
        ...model.extraParams,
      }, { signal: abortControllerRef.current.signal });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;

        if (delta?.reasoning_content) {
          thinkingChars += delta.reasoning_content.length;
          setStreamThinkingChars(thinkingChars);
          setStreamThinkingContent((prev) => prev + delta.reasoning_content);
          setStreamPercent((value) => Math.min(value + 1, 70));
        }

        if (delta?.content) {
          reply += delta.content;
          setStreamChars(reply.length);
          setStreamResponseContent((prev) => prev + delta.content);
          setStreamPercent((value) => Math.min(Math.max(value, 10) + 1, 98));

          pathRegex.lastIndex = Math.max(0, searchIndex - 16);
          let match;
          while ((match = pathRegex.exec(reply)) !== null) {
            registerFile(match[1]);
          }
          searchIndex = reply.length;
        }
      }

      setStreamPercent(100);

      if (!reply.trim()) {
        return { type: 'system', text: 'No response received.', id: nextId() };
      }

      let cleaned = reply;
      if (!cleaned.trim().startsWith('{')) {
        const jsonStart = cleaned.indexOf('{');
        if (jsonStart !== -1) cleaned = cleaned.slice(jsonStart);
      }

      const parsed = parseJSON(cleaned);
      if (!parsed) {
        updateSummary({
          duration: `${((Date.now() - startTimeRef.current) / 1000).toFixed(1)}s`,
        });
        return { type: 'assistant', text: reply.trim(), id: nextId() };
      }

      const summary = { ...DEFAULT_SUMMARY, loopCount: 1 };
      let resultText = '';

      if (parsed.plan) {
        resultText += `Plan:\n${parsed.plan.map((item, index) => `  ${index + 1}. ${item}`).join('\n')}\n\n`;
        pushActivity('status', `Plan generated with ${parsed.plan.length} step(s)`);
      }

      if (parsed.files && Array.isArray(parsed.files)) {
        resultText += `Applying ${parsed.files.length} file(s)...\n`;

        for (const file of parsed.files) {
          if (!file.path) continue;

          const absolutePath = path.resolve(projectDir, file.path.replace(/^(\/|\\)+/, ''));
          const existedBefore = fs.existsSync(absolutePath);

          try {
            if (file.edits && Array.isArray(file.edits)) {
              patchFile(projectDir, file.path, null, file.edits, { reporter, silent: true });
              summary.filesEdited += 1;
            } else if (typeof file.content === 'string') {
              patchFile(projectDir, file.path, file.content, null, { reporter, silent: true });
              if (existedBefore) summary.filesEdited += 1;
              else summary.filesCreated += 1;
            }
            resultText += `  ${file.path}\n`;
          } catch (error) {
            summary.errors += 1;
            resultText += `  ${file.path}: ${error.message}\n`;
          }
        }
      }

      if (parsed.commands && Array.isArray(parsed.commands) && parsed.commands.length > 0) {
        resultText += `Executing ${parsed.commands.length} command(s)...\n`;
        try {
          const commandResult = await runCommands(parsed.commands, projectDir, {
            source: 'tui_standard',
            reporter,
            silent: true,
          });
          summary.commandsRun += commandResult.executed || 0;
          summary.errors += commandResult.failed || 0;
          resultText += '  Commands executed\n';
        } catch (error) {
          summary.errors += 1;
          resultText += `  Command error: ${error.message}\n`;
        }
      }

      if (parsed.instructions) {
        resultText += `Manual steps:\n${parsed.instructions.map((item, index) => `  ${index + 1}. ${item}`).join('\n')}`;
      }

      summary.duration = `${((Date.now() - startTimeRef.current) / 1000).toFixed(1)}s`;
      updateSummary(summary);

      return {
        type: 'assistant',
        text: resultText.trim() || reply.trim(),
        id: nextId(),
      };
    } catch (error) {
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted by user.', id: nextId() };
      return { type: 'system', text: `API Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId, pushActivity, registerFile, startTimer, updateSummary]);

  const runAgentMode = useCallback(async (query, msgHistory, activeMode, reporter) => {
    const client = clientRef.current;
    if (!client) {
      return { type: 'system', text: 'API client is not configured. Check your environment variables.', id: nextId() };
    }

    const [
      { default: runAgentPipeline },
      { buildSmartContext },
      { patchFile },
      { runCommands },
      { gitCheckpoint, gitRestore, gitDiscard },
      { listWorkspaceEntries, searchWorkspaceFiles, searchWorkspaceContent },
      path,
      fs,
      { parseJSON },
    ] = await Promise.all([
      import('../../engine/agentController.js'),
      import('../../engine/context.js'),
      import('../../engine/patchEngine.js'),
      import('../../engine/commandExecutor.js'),
      import('../../utils/git.js'),
      import('../../utils/fileTools.js'),
      import('path'),
      import('fs'),
      import('../../engine/jsonParser.js'),
    ]);

    const projectDir = process.cwd();
    const smartContext = buildSmartContext(projectDir, query, model, msgHistory);
    
    abortControllerRef.current = new AbortController();

    const runtime = {
      reporter,
      parseJSON,
      modelConfig: model,
      callAI: async (agentMessages, tools = undefined) => {
        let replyContent = '';
        let thinkingChars = 0;
        const toolCalls = [];

        startTimer();
        const stream = await client.chat.completions.create({
          model: model.id,
          messages: agentMessages,
          temperature: model.temperature,
          top_p: model.topP,
          max_tokens: model.maxTokens,
          stream: true,
          tools,
          ...model.extraParams,
        }, { signal: abortControllerRef.current.signal });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            thinkingChars += delta.reasoning_content.length;
            setStreamThinkingChars(thinkingChars);
            setStreamThinkingContent((prev) => prev + delta.reasoning_content);
            setStreamPercent((value) => Math.min(value + 1, 65));
          }

          if (delta.content) {
            replyContent += delta.content;
            setStreamChars(replyContent.length);
            setStreamResponseContent((prev) => prev + delta.content);
            setStreamPercent((value) => Math.min(Math.max(value, 10) + 1, 99));
          }

          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;
              if (toolCalls[index] === undefined) {
                toolCalls[index] = {
                  id: toolCall.id || '',
                  type: 'function',
                  function: { name: toolCall.function?.name || '', arguments: '' },
                };
              } else {
                if (toolCall.id) toolCalls[index].id = toolCall.id;
                if (toolCall.function?.name) toolCalls[index].function.name = toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                toolCalls[index].function.arguments += toolCall.function.arguments;
              }
            }
          }
        }

        setStreamPercent(100);
        stopTimer();

        return {
          role: 'assistant',
          content: replyContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls.filter(Boolean) : undefined,
        };
      },
      readFile: (filePath) => {
        const cleanPath = filePath.replace(/^\/+/, '');
        return fs.readFileSync(path.resolve(projectDir, cleanPath), 'utf8');
      },
      patchFile: (filePath, content, edits, patchOptions = {}) => patchFile(projectDir, filePath, content, edits, patchOptions),
      runCommand: async (command, cwd, commandOptions = {}) => {
        const workingDir = cwd ? path.resolve(projectDir, cwd) : projectDir;
        return runCommands([command], workingDir, {
          source: 'tui_agent',
          reporter,
          silent: true,
          ...commandOptions,
        });
      },
      listFiles: async (subpath = '.', depth = 2, includeHidden = false) => listWorkspaceEntries(projectDir, subpath, { depth, includeHidden }),
      searchFiles: async (pattern) => searchWorkspaceFiles(projectDir, pattern),
      searchContent: async (searchText) => searchWorkspaceContent(projectDir, searchText),
      buildFreshContext: (freshQuery) => buildSmartContext(projectDir, freshQuery, model, msgHistory),
    };

    const checkpoint = gitCheckpoint(projectDir);

    try {
      let role = 'general';
      if (activeMode.value === 'planner') role = 'plan';
      if (activeMode.value === 'orchestrator') role = 'orchestrator';

      let execResult;
      if (activeMode.value === 'planner') {
        const planDir = path.join(projectDir, '.kilo', 'plans');
        if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true });
        const planFile = path.join(planDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-plan.md`);
        const reminder = `\n\n<system-reminder>\nPlan Mode: Write the final plan only to ${planFile}\nCall plan_exit when finished.\n</system-reminder>\n`;
        execResult = await runAgentPipeline(query + reminder, smartContext, runtime, {
          autoPolish: false,
          role,
          reporter,
        });
        pushActivity('status', `Plan file prepared at ${planFile}`);
      } else {
        execResult = await runAgentPipeline(query, smartContext, runtime, {
          autoPolish: activeMode.value === 'polish',
          role,
          reporter,
        });
      }

      if (checkpoint) gitDiscard(checkpoint);

      if (!execResult?.finalMessage) {
        return { type: 'system', text: 'Agent pipeline produced no output.', id: nextId() };
      }

      return {
        type: 'assistant',
        text: typeof execResult.finalMessage.content === 'string'
          ? execResult.finalMessage.content
          : 'Agent pipeline completed.',
        id: nextId(),
      };
    } catch (error) {
      if (checkpoint) gitRestore(checkpoint);
      updateSummary({ errors: (currentSummaryRef.current.errors || 0) + 1 });
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted by user.', id: nextId() };
      return { type: 'system', text: `Agent Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId, pushActivity, startTimer, stopTimer, updateSummary]);

  const executeHandler = useCallback(async (query, activeMode = mode) => {
    setIsThinking(true);
    setLastStatus('Working');
    resetRunState(`${activeMode.label} running`);

    const reporter = buildReporter(activeMode);
    let resultMsg;

    try {
      const msgSnapshot = [...messages];
      switch (activeMode.value) {
        case 'ask':
          resultMsg = await runAskMode(query, msgSnapshot);
          break;
        case 'standard':
          resultMsg = await runStandardMode(query, msgSnapshot, reporter);
          break;
        case 'agent':
        case 'orchestrator':
        case 'planner':
        case 'polish':
          resultMsg = await runAgentMode(query, msgSnapshot, activeMode, reporter);
          break;
        default:
          resultMsg = await runAskMode(query, msgSnapshot);
          break;
      }
    } catch (error) {
      resultMsg = { type: 'system', text: `Error: ${error.message}`, id: nextId() };
      updateSummary({ errors: (currentSummaryRef.current.errors || 0) + 1 });
    }

    setMessages((previous) => [...previous, resultMsg]);
    setMsgCount((count) => count + 1);
    finishRun(resultMsg);
    setInput('');
  }, [
    mode,
    messages,
    nextId,
    buildReporter,
    finishRun,
    resetRunState,
    runAgentMode,
    runAskMode,
    runStandardMode,
    updateSummary,
  ]);

  const handleSubmit = useCallback((value) => {
    // Handle ask_user question response
    if (pendingQuestion && questionResolverRef.current) {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Add the response to chat history
      setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);

      // Resolve the promise with the user's answer
      const resolver = questionResolverRef.current;
      questionResolverRef.current = null;
      setPendingQuestion(null);
      setInput('');
      resolver(trimmed);
      return;
    }

    if (isThinkingRef.current) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    // Add to history and reset index
    setHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);

    if (trimmed.toLowerCase() === '/exit' || trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === '/quit') {
      onExit();
      return;
    }

    if (trimmed.toLowerCase() === '/clear') {
      setMessages([{ type: 'system', text: 'Chat history cleared.', id: nextId() }]);
      setLastSummary(null);
      setLastFiles([]);
      setLastActivityLog([]);
      setLastStatus('Ready');
      setInput('');
      setScrollOffset(0);
      return;
    }

    if (trimmed.toLowerCase() === 'undo' || trimmed.toLowerCase() === 'n') {
      setMessages((previous) => [
        ...previous,
        { type: 'user', text: trimmed, id: nextId() },
        { type: 'system', text: 'Undo is only available in the legacy CLI flow right now.', id: nextId() },
      ]);
      setInput('');
      return;
    }

    if (trimmed.startsWith('/build')) {
      const command = trimmed.slice(6).trim();
      if (!command) {
        setMessages((previous) => [
          ...previous,
          { type: 'system', text: customBuildCmd ? `Current build command: ${customBuildCmd}` : 'No custom build command is set yet.', id: nextId() },
        ]);
      } else {
        setCustomBuildCmd(command);
        setMessages((previous) => [
          ...previous,
          { type: 'system', text: `Build command set: ${command}`, id: nextId() },
        ]);
      }
      setInput('');
      return;
    }

    let activeMode = mode;
    let query = trimmed;

    if (trimmed.startsWith('/plan')) {
      activeMode = MODE_MAP.planner;
      query = trimmed.slice(5).trim() || 'Create a detailed implementation plan.';
    } else if (trimmed.startsWith('/polish')) {
      activeMode = MODE_MAP.polish;
      query = trimmed.slice(7).trim() || 'Improve code quality, UI, and UX.';
    } else if (trimmed.startsWith('/agent')) {
      activeMode = MODE_MAP.agent;
      query = trimmed.slice(6).trim() || trimmed;
    } else if (trimmed.startsWith('/ask')) {
      activeMode = MODE_MAP.ask;
      query = trimmed.slice(4).trim() || trimmed;
    }

    setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
    setInput('');
    setScrollOffset(0);
    executeHandler(query, activeMode);
  }, [customBuildCmd, executeHandler, mode, nextId, onExit, pendingQuestion]);

  const handleChange = useCallback((value) => {
    if (!isThinkingRef.current || pendingQuestion) {
      setInput(value);
    }
  }, [pendingQuestion]);

  // Handle Question Box Selection
  const handleQuestionSelect = useCallback((item) => {
    if (item.value === 'CANCEL' || item.value === 'NONE') {
      setShowQuestions(false);
    } else {
      setShowQuestions(false);
      handleSubmit(item.value);
    }
  }, [handleSubmit]);

  // Memoize Questions Items for the Select List
  const questionItems = useMemo(() => {
    const items = [];
    const uniqueHistory = [...new Set(history)].reverse();
    
    uniqueHistory.forEach((h, i) => {
      items.push({ label: `[History]  ${truncate(h, 60)}`, value: h, key: `hist-${i}` });
    });

    // Note: Questions dynamically suggested by the LLM will be populated here in the future.

    if (items.length === 0) {
      items.push({ label: 'No history or suggested questions available.', value: 'NONE', key: 'none' });
    }

    items.push({ label: '← Back to typing (Esc)', value: 'CANCEL', key: 'cancel' });
    return items;
  }, [history]);

  // --------------------------------------------------------------------------
  // LINE WRAPPING AND SCROLL CALCULATION ENGINE
  // --------------------------------------------------------------------------
  
  const visibleActivity = (isThinking ? activityLog : lastActivityLog).slice(-6);
  const showTrace = (isThinking || lastSummary || lastFiles.length > 0 || lastActivityLog.length > 0) && scrollOffset === 0;
  
  // 1. Calculate how many lines the dynamic UI elements take up
  let traceLines = 0;
  if (showTrace) {
    traceLines += 3; // borders + title padding
    if (!isThinking && lastSummary) traceLines += 6; // summary stats
    traceLines += visibleActivity.length; // activity logs
  }
  if (scrollOffset > 0) traceLines += 2; // scroll indicator box
  if (isThinking) {
    traceLines += 3; // basic streaming panel height
    if (streamPercent < 60) traceLines += 3; // thinking box height roughly
    if (streamFiles.length > 0) traceLines += 1 + streamFiles.length; // files block
  }

  // 2. Subtract fixed UI elements to find strictly available chat lines
  const fixedHeaderAndInputHeight = 6; 
  const chatLinesAvailable = Math.max(2, dims.rows - fixedHeaderAndInputHeight - traceLines);
  const maxLineWidth = Math.max(20, colLeft - 4); // Account for container padding

  // 3. Flatten all messages into wrapped lines (Memoized for Performance)
  const allLines = useMemo(() => {
    let lines = [];

    messages.forEach((msg) => {
      if (msg.type === 'system') {
        const wrapped = wrapText(msg.text, maxLineWidth);
        wrapped.forEach(l => lines.push({ text: l, color: THEME.dim }));
      } else if (msg.type === 'user') {
        // Calculate bubble dimensions (max 75% of chat width)
        const bubbleMaxWidth = Math.max(20, Math.floor(maxLineWidth * 0.75));
        const wrapped = wrapText(msg.text, bubbleMaxWidth);
        const contentMaxLen = Math.max('You'.length, ...wrapped.map(l => getCharWidth(l)));
        
        // Right alignment padding
        const leftPad = ' '.repeat(Math.max(0, maxLineWidth - (contentMaxLen + 4)));
        
        // Top border
        lines.push({ parts: [
          { text: leftPad, color: THEME.dim },
          { text: `╭${'─'.repeat(contentMaxLen + 2)}╮`, color: THEME.dim }
        ]});
        
        // Header
        lines.push({ parts: [
          { text: leftPad, color: THEME.dim },
          { text: `│ `, color: THEME.dim },
          { text: 'You' + ' '.repeat(Math.max(0, contentMaxLen - 3)), color: THEME.accent, bold: true },
          { text: ` │`, color: THEME.dim }
        ]});
        
        // Content lines
        wrapped.forEach(l => {
          const padding = ' '.repeat(Math.max(0, contentMaxLen - getCharWidth(l)));
          lines.push({ parts: [
            { text: leftPad, color: THEME.dim },
            { text: `│ `, color: THEME.dim },
            { text: l + padding, color: THEME.text },
            { text: ` │`, color: THEME.dim }
          ]});
        });
        
        // Bottom border
        lines.push({ parts: [
          { text: leftPad, color: THEME.dim },
          { text: `╰${'─'.repeat(contentMaxLen + 2)}╯`, color: THEME.dim }
        ]});
      } else {
        lines.push({ text: 'DevAI', color: THEME.accent, bold: true });
        
        const wrapped = wrapText(msg.text, maxLineWidth);
        let inCodeBlock = false;

        wrapped.forEach(l => {
          if (l.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            lines.push({ text: l, color: THEME.dim }); // Style the backticks
          } else {
            // Syntax Highlight: Yellow if inside code block, normal otherwise
            lines.push({ text: l, color: inCodeBlock ? '#E5C07B' : THEME.text }); 
          }
        });
      }
      lines.push({ text: '', empty: true });
    });

    if (lines.length > 0 && lines[lines.length - 1].empty) lines.pop();
    return lines;
  }, [messages, maxLineWidth]);

  // 4. Calculate Slice based on manual scrolling offset
  const maxScroll = Math.max(0, allLines.length - chatLinesAvailable);
  const clampedScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const startIndex = Math.max(0, allLines.length - chatLinesAvailable - clampedScroll);
  const visibleLines = allLines.slice(startIndex, startIndex + chatLinesAvailable);

  // --------------------------------------------------------------------------
  
  const sidebarFiles = isThinking ? streamFiles : lastFiles;
  const sidebarSummary = isThinking ? currentSummary : lastSummary;
  const barWidth = Math.max(8, colRight - 10);
  const filled = Math.min(barWidth, Math.round((streamPercent / 100) * barWidth));
  const progressBar = `${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}`;

  if (showQuestions) {
    return (
      <Box flexDirection="column" height={dims.rows - 1} width="100%" alignItems="center" justifyContent="center">
        <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={72}>
          <Text color={THEME.accent} bold marginBottom={1}>Select a Question</Text>
          <Text color={THEME.dim} marginBottom={1}>Use ↑/↓ arrows to navigate, Enter to select</Text>
          <Box flexDirection="column" paddingX={2}>
            <SelectInput
              items={questionItems}
              onSelect={handleQuestionSelect}
              indicatorComponent={({ isSelected }) => (
                <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '❯ ' : '  '}</Text>
              )}
              itemComponent={({ isSelected, label }) => (
                <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                  {label}
                </Text>
              )}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={dims.rows - 1} width="100%">
      <Box
        paddingX={2}
        marginBottom={1}
        borderBottom
        borderStyle="single"
        borderColor={THEME.border}
        justifyContent="space-between"
      >
        <Text color={THEME.dim}>
          <Text color={THEME.text} bold>DevAI Workspace</Text> - {mode.label} | {model.name}
        </Text>
        <Text color={THEME.dim}>/clear | /exit | ↑/↓/PgUp/PgDn to scroll</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} width="100%">
        <Box flexDirection="column" width={colLeft} height="100%">
          
          <Box flexGrow={1} flexDirection="column" overflowY="hidden" paddingX={1}>
            
            {/* Scroll Indicator */}
            {scrollOffset > 0 && (
              <Box justifyContent="center" marginBottom={1}>
                <Text color={THEME.accent}>↑ Scrolled up {clampedScroll} lines ↑</Text>
              </Box>
            )}

            {/* Flat Line Renderer */}
            {visibleLines.map((line, index) => (
              <Box key={index} marginBottom={0} flexDirection="row">
                {line.parts ? (
                  line.parts.map((p, i) => (
                    <Text key={i} color={p.color} bold={p.bold}>{p.text}</Text>
                  ))
                ) : (
                  <Text color={line.color} bold={line.bold}>{line.text}</Text>
                )}
              </Box>
            ))}

            {isThinking && (
              <Box flexDirection="column" marginBottom={1} marginTop={1}>
                <Text color={THEME.accent} bold>{THINKING_FRAMES[thinkFrame]} DevAI</Text>
                <StreamingPanel
                  label={streamLabel}
                  percent={streamPercent}
                  chars={streamChars}
                  thinkingChars={streamThinkingChars}
                  thinkingContent={streamThinkingContent}
                  responseContent={streamResponseContent}
                  files={streamFiles}
                  elapsed={streamElapsed}
                />
              </Box>
            )}

            {showTrace && (
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={THEME.border}
                paddingX={1}
                marginBottom={1}
                marginTop={1}
              >
                <Text color={THEME.accent} bold>
                  {isThinking ? 'Execution Trace' : 'Last Run'}
                </Text>

                {!isThinking && lastSummary && (
                  <>
                    <Text color={THEME.text}>Files created : {lastSummary.filesCreated}</Text>
                    <Text color={THEME.text}>Files edited  : {lastSummary.filesEdited}</Text>
                    <Text color={THEME.text}>Commands run  : {lastSummary.commandsRun}</Text>
                    <Text color={lastSummary.errors > 0 ? THEME.warning : THEME.text}>Errors        : {lastSummary.errors}</Text>
                    <Text color={THEME.text}>Duration      : {lastSummary.duration}</Text>
                    <Text color={THEME.text}>Agent turns   : {lastSummary.loopCount}</Text>
                  </>
                )}

                {visibleActivity.map((entry, index) => (
                  <Text key={`${entry.text}-${index}`} color={statusTone(entry)}>
                    {entry.text}
                  </Text>
                ))}
              </Box>
            )}
          </Box>

          {pendingQuestion && (
            <Box flexDirection="column" borderStyle="round" borderColor={THEME.warning} paddingX={1} marginX={1} marginBottom={1}>
              <Text color={THEME.warning} bold>Agent asks:</Text>
              <Text color={THEME.text}>{pendingQuestion}</Text>
              <Text color={THEME.dim}>Type your answer and press Enter</Text>
            </Box>
          )}

          <Box
            flexDirection="row"
            paddingX={1}
            paddingTop={1}
            borderTop
            borderStyle="single"
            borderColor={THEME.border}
          >
            <Box marginRight={1}>
              <Text color={pendingQuestion ? THEME.warning : isThinking ? THEME.error : THEME.accent} bold>
                {pendingQuestion ? '?' : isThinking ? '■' : '>'}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <TextInput
                value={input}
                onChange={handleChange}
                onSubmit={handleSubmit}
                placeholder={pendingQuestion ? 'Type your answer...' : isThinking ? 'Press ESC to cancel execution...' : 'Type a message...'}
                focus={!isThinking || pendingQuestion}
                showCursor
              />
            </Box>
          </Box>
        </Box>

        <Box flexDirection="column" width={1} marginLeft={1} marginRight={1}>
          {Array.from({ length: Math.max(0, dims.rows - 3) }).map((_, index) => (
            <Text key={index} color={THEME.border}>|</Text>
          ))}
        </Box>

        <Box flexDirection="column" width={colRight} height="100%" paddingX={1}>
          <Box marginBottom={1}>
            <Text color={THEME.accent} bold>SESSION</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={THEME.dim}>Mode</Text>
            <Text color={THEME.text}>  {mode.label}</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={THEME.dim}>Model</Text>
            <Text color={THEME.text}>  {model.name}</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={THEME.dim}>Status</Text>
            <Text color={isThinking ? THEME.warning : lastStatus === 'Completed' ? THEME.success : lastStatus.includes('Error') || lastStatus.includes('Abort') ? THEME.error : THEME.text}>
              {'  '}
              {isThinking ? `${THINKING_FRAMES[thinkFrame]} ${streamLabel}` : lastStatus}
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={THEME.dim}>Time</Text>
            <Text color={THEME.text}>  {sessionTime}</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            <Text color={THEME.dim}>Messages</Text>
            <Text color={THEME.text}>  {msgCount} exchanges</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={THEME.border}>{'-'.repeat(colRight - 2)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={THEME.accent} bold>STREAM</Text>
          </Box>

          {isThinking ? (
            <Box flexDirection="column">
              <Box marginBottom={1}>
                <Text color={THEME.accent}>{progressBar}</Text>
                <Text color={THEME.text}> {Math.floor(streamPercent)}%</Text>
              </Box>
              <Text color={THEME.dim}>Label    <Text color={THEME.text}>{truncate(streamLabel, Math.max(12, colRight - 11))}</Text></Text>
              <Text color={THEME.dim}>Chars    <Text color={THEME.text}>{streamChars.toLocaleString()}</Text></Text>
              <Text color={THEME.dim}>Thinking <Text color={THEME.text}>{streamThinkingChars.toLocaleString()}</Text></Text>
              <Text color={THEME.dim}>Time     <Text color={THEME.text}>{streamElapsed}s</Text></Text>
            </Box>
          ) : sidebarSummary ? (
            <Box flexDirection="column">
              <Text color={THEME.dim}>Files+   <Text color={THEME.text}>{sidebarSummary.filesCreated}</Text></Text>
              <Text color={THEME.dim}>Edits    <Text color={THEME.text}>{sidebarSummary.filesEdited}</Text></Text>
              <Text color={THEME.dim}>Cmds     <Text color={THEME.text}>{sidebarSummary.commandsRun}</Text></Text>
              <Text color={THEME.dim}>Errors   <Text color={sidebarSummary.errors > 0 ? THEME.warning : THEME.text}>{sidebarSummary.errors}</Text></Text>
              <Text color={THEME.dim}>Turns    <Text color={THEME.text}>{sidebarSummary.loopCount}</Text></Text>
              <Text color={THEME.dim}>Time     <Text color={THEME.text}>{sidebarSummary.duration}</Text></Text>
            </Box>
          ) : (
            <Text color={THEME.dim}>  Waiting for input...</Text>
          )}

          <Box marginTop={1} marginBottom={1}>
            <Text color={THEME.border}>{'-'.repeat(colRight - 2)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={THEME.accent} bold>SHORTCUTS</Text>
          </Box>
          <Box flexDirection="column">
            <Text color={THEME.dim}>  ↑/↓       - Scroll chat</Text>
            <Text color={THEME.dim}>  PgUp/PgDn - Fast scroll</Text>
            <Text color={THEME.dim}>  Ctrl+P    - Prev prompt</Text>
            <Text color={THEME.dim}>  Ctrl+N    - Next prompt</Text>
            <Text color={THEME.dim}>  Ctrl+Q    - Questions</Text>
            <Text color={THEME.dim}>  Ctrl+C    - Cancel run</Text>
          </Box>

          <Box marginTop={1} marginBottom={1}>
            <Text color={THEME.border}>{'-'.repeat(colRight - 2)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color={THEME.accent} bold>COMMANDS</Text>
          </Box>
          <Box flexDirection="column">
            <Text color={THEME.dim}>  /plan   - Planner run</Text>
            <Text color={THEME.dim}>  /polish - Polish run</Text>
            <Text color={THEME.dim}>  /ask    - Ask-only run</Text>
            <Text color={THEME.dim}>  /agent  - Agent run</Text>
            <Text color={THEME.dim}>  /clear  - Clear chat</Text>
          </Box>

          {customBuildCmd ? (
            <Box marginTop={1}>
              <Text color={THEME.dim}>Build cmd: <Text color={THEME.text}>{truncate(customBuildCmd, Math.max(10, colRight - 14))}</Text></Text>
            </Box>
          ) : null}

          <Box flexGrow={1} />

        </Box>
      </Box>
    </Box>
  );
};

export default ChatScreen;