import { useCallback, useEffect, useRef, useState } from 'react';
import { useStdout, useInput } from 'ink';
import { MODES } from '../constants.js';
import { createTuiReporter } from '../uiReporter.js';
import { createClient } from '../../config/apiClient.js';
import { estimateTokens, getSafeMaxTokens } from '../../utils/budgeting.js';
import {
  DEFAULT_SUMMARY,
  truncate,
  buildToolNarrationSummary,
  getToolDisplayName,
  getToolPhaseLabel,
  shouldInlineToolDetails,
  buildInlineDetailText,
  buildInlineToolDetailText,
  formatToolArgs,
  findLatestCollapsibleId,
  mergeSummary,
  summarizeFileChange,
  stripSystemAndEnv,
} from './chatUtils.js';

const MODE_MAP = Object.fromEntries(MODES.map((mode) => [mode.value, mode]));

function estimateMessageTokens(messages = []) {
  return messages.reduce((total, message) => {
    const content = typeof message?.content === 'string'
      ? message.content
      : typeof message?.text === 'string'
        ? message.text
        : message?.content != null
          ? JSON.stringify(message.content)
          : '';
    return total + estimateTokens(content || '');
  }, 0);
}

export function useChatState({ mode, model, availableModes = MODES, availableModels = [], onModeChange, onModelChange, onExit }) {
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [pickerState, setPickerState] = useState(null);
  const [followLive, setFollowLive] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);

  const [expandedBlocks, setExpandedBlocks] = useState(new Set());

  const [streamLabel, setStreamLabel] = useState('Waiting for input');
  const [streamResponseContent, setStreamResponseContent] = useState('');
  const [activityLog, setActivityLog] = useState([]);
  const [liveTick, setLiveTick] = useState(0);
  const [liveStatus, setLiveStatus] = useState(null);

  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [pendingQuestionIndex, setPendingQuestionIndex] = useState(0);
  const [pendingQuestionManualEntry, setPendingQuestionManualEntry] = useState(false);
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
  const liveStatusTimeoutRef = useRef(null);
  const visibleCollapsibleIdRef = useRef(null);
  const activeToolPhaseRef = useRef('');
  const activeRunTokenRef = useRef(0);

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

  useEffect(() => () => {
    if (liveStatusTimeoutRef.current) {
      clearTimeout(liveStatusTimeoutRef.current);
    }
  }, []);

  const toggleLatestCollapsible = useCallback(() => {
    const targetId = visibleCollapsibleIdRef.current || findLatestCollapsibleId(currentActivityRef.current, messages);
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
    if (pendingQuestion) {
      const options = Array.isArray(pendingQuestion.options) ? pendingQuestion.options : [];
      const totalChoices = options.length > 0 ? options.length + 1 : 0;

      if (options.length > 0 && !pendingQuestionManualEntry) {
        if (key.upArrow) {
          setPendingQuestionIndex((prev) => (prev <= 0 ? totalChoices - 1 : prev - 1));
          return;
        }
        if (key.downArrow) {
          setPendingQuestionIndex((prev) => (prev + 1) % totalChoices);
          return;
        }
        if (key.escape) {
          setPendingQuestionManualEntry(false);
          setPendingQuestionIndex(0);
          setInput('');
          return;
        }
        if (key.return) {
          if (pendingQuestionIndex === options.length) {
            setPendingQuestionManualEntry(true);
            setInput('');
          } else {
            resolvePendingQuestionAnswer(options[pendingQuestionIndex] || options[0]);
          }
          return;
        }
      }

      if (pendingQuestionManualEntry && key.escape) {
        setPendingQuestionManualEntry(false);
        setPendingQuestionIndex(options.length);
        setInput('');
        return;
      }
      return;
    }

    if (inputChars === '?' && !key.ctrl && !key.meta && !key.escape && input.trim() === '') {
      setShowShortcuts((prev) => !prev);
      return;
    }

    if (key.escape && pickerState) {
      setPickerState(null);
      return;
    }

    if (key.escape && showShortcuts) {
      setShowShortcuts(false);
      return;
    }

    if (!showQuestions) {
      if (key.upArrow) {
        setFollowLive(false);
        setScrollOffset((prev) => prev + 1);
        return;
      }
      if (key.downArrow) {
        setScrollOffset((prev) => {
          const next = Math.max(0, prev - 1);
          setFollowLive(next === 0);
          return next;
        });
        return;
      }
      if (key.pageUp) {
        setFollowLive(false);
        setScrollOffset((prev) => prev + 10);
        return;
      }
      if (key.pageDown) {
        setScrollOffset((prev) => {
          const next = Math.max(0, prev - 10);
          setFollowLive(next === 0);
          return next;
        });
        return;
      }
      if (key.home) {
        setFollowLive(false);
        setScrollOffset(Number.MAX_SAFE_INTEGER);
        return;
      }
      if (key.end) {
        setFollowLive(true);
        setScrollOffset(0);
        return;
      }
    }

    if (isThinkingRef.current) {
      if (key.escape || (key.ctrl && inputChars === 'c')) {
        stopActiveRun();
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

  const resolvePendingQuestionAnswer = useCallback((answer) => {
    pushActivity('success', `Answer: ${answer}`);

    const resolver = questionResolverRef.current;
    questionResolverRef.current = null;
    setPendingQuestion(null);
    setPendingQuestionIndex(0);
    setPendingQuestionManualEntry(false);
    setInput('');
    if (typeof resolver === 'function') resolver(answer);
  }, [pushActivity]);

  const resetRunState = useCallback((label) => {
    if (liveStatusTimeoutRef.current) {
      clearTimeout(liveStatusTimeoutRef.current);
      liveStatusTimeoutRef.current = null;
    }
    currentActivityRef.current = [];
    currentSummaryRef.current = DEFAULT_SUMMARY;
    activeToolPhaseRef.current = '';
    setStreamLabel(label);
    setStreamResponseContent('');
    setActivityLog([]);
    setFollowLive(true);
    setScrollOffset(0);
    setCurrentTurn(1);
    setLiveStatus({ kind: 'thinking', label });
  }, []);

  const finishRun = useCallback((status = 'success', label = null) => {
    setIsThinking(false);
    abortControllerRef.current = null;
    const nextLabel = label || (status === 'error' ? 'Run failed' : 'Run complete');
    setLiveStatus({ kind: status, label: nextLabel });

    if (liveStatusTimeoutRef.current) {
      clearTimeout(liveStatusTimeoutRef.current);
    }

    liveStatusTimeoutRef.current = setTimeout(() => {
      setLiveStatus(null);
      liveStatusTimeoutRef.current = null;
    }, status === 'error' ? 1600 : 1200);
  }, []);

  const stopActiveRun = useCallback(() => {
    if (!isThinkingRef.current || !abortControllerRef.current) return false;

    activeRunTokenRef.current += 1;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;

    const archivedActivity = [...currentActivityRef.current];
    const partialText = streamResponseContent.trim();

    setMessages((previous) => {
      const nextMessages = [...previous];
      if (archivedActivity.length > 0 || partialText) {
        nextMessages.push({
          type: 'assistant',
          text: partialText,
          id: nextId(),
          activityLog: archivedActivity,
        });
      }
      nextMessages.push({
        type: 'system',
        text: 'Response stopped by user.',
        id: nextId(),
      });
      return nextMessages;
    });

    currentActivityRef.current = [];
    activeToolPhaseRef.current = '';
    setActivityLog([]);
    setStreamResponseContent('');
    setFollowLive(true);
    finishRun('error', 'Stopped by user');
    return true;
  }, [finishRun, nextId, streamResponseContent]);

  const appendMessage = useCallback((type, text, extra = {}) => {
    setMessages((previous) => [...previous, { type, text, id: nextId(), ...extra }]);
  }, [nextId]);

  const applyModeSwitch = useCallback((selectedMode) => {
    if (!selectedMode) return;
    if (typeof onModeChange === 'function') onModeChange(selectedMode);
    appendMessage('system', `Mode switched to ${selectedMode.label}.`);
    setPickerState(null);
  }, [appendMessage, onModeChange]);

  const applyModelSwitch = useCallback((selectedModel) => {
    if (!selectedModel) return;
    if (typeof onModelChange === 'function') onModelChange(selectedModel);
    appendMessage('system', `Model switched to ${selectedModel.name}.`);
    setPickerState(null);
  }, [appendMessage, onModelChange]);

  const handlePickerSelect = useCallback((item) => {
    if (!item || item.value === 'CANCEL') {
      setPickerState(null);
      return;
    }
    if (pickerState?.type === 'mode') applyModeSwitch(item.payload);
    if (pickerState?.type === 'model') applyModelSwitch(item.payload);
  }, [applyModeSwitch, applyModelSwitch, pickerState]);

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

    let finalStatus = 'success';
    let finalLabel = 'Git push complete';
    setIsThinking(true);
    resetRunState('Git running');
    setScrollOffset(0);

    try {
      const statusResult = await runDirectProcess('git', ['status', '--short']);
      const pendingChanges = `${statusResult.stdout || ''}${statusResult.stderr || ''}`.trim();

      if (!pendingChanges) {
        finalStatus = 'error';
        finalLabel = 'Nothing to commit';
        appendMessage('system', 'There are no local changes to commit.');
        return;
      }

      const addResult = await runDirectProcess('git', ['add', '-A']);
      if (!addResult.ok) {
        finalStatus = 'error';
        finalLabel = 'Git add failed';
        appendMessage('system', 'Git add failed. Review the transcript above for the exact error.');
        return;
      }

      const commitResult = await runDirectProcess('git', ['commit', '-m', message]);
      const commitOutput = `${commitResult.stdout || ''}\n${commitResult.stderr || ''}`.trim();
      if (!commitResult.ok) {
        finalStatus = 'error';
        finalLabel = /nothing to commit/i.test(commitOutput) ? 'Nothing to commit' : 'Git commit failed';
        if (/nothing to commit/i.test(commitOutput)) {
          appendMessage('system', 'Git reported that there was nothing to commit.');
        } else {
          appendMessage('system', 'Git commit failed. Review the transcript above for the exact error.');
        }
        return;
      }

      const pushResult = await runDirectProcess('git', ['push']);
      if (!pushResult.ok) {
        finalStatus = 'error';
        finalLabel = 'Git push failed';
        appendMessage('system', 'Git push failed. Review the transcript above for the exact error.');
        return;
      }

      appendMessage('assistant', `Committed and pushed your current changes with message: ${message}`);
    } catch (error) {
      finalStatus = 'error';
      finalLabel = 'Git shortcut failed';
      appendMessage('system', `Git shortcut failed: ${error.message}`);
    } finally {
      finishRun(finalStatus, finalLabel);
      setInput('');
    }
  }, [appendMessage, finishRun, resetRunState, runDirectProcess]);

  const runUndoShortcut = useCallback(async () => {
    const checkpoint = lastCheckpointRef.current;
    if (!checkpoint) {
      appendMessage('system', 'There is no saved AI checkpoint to undo right now.');
      return;
    }

    let finalStatus = 'success';
    let finalLabel = 'Undo complete';
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
      finalStatus = 'error';
      finalLabel = 'Undo failed';
      appendMessage('system', `Undo failed: ${error.message}`);
    } finally {
      finishRun(finalStatus, finalLabel);
      setInput('');
    }
  }, [appendMessage, finishRun, pushActivity, resetRunState]);

  const buildReporter = useCallback((activeMode) => createTuiReporter({
    phaseHeader: ({ label }) => {
      setStreamLabel(label || `${activeMode.label} running`);
    },
    phaseStatus: ({ status, text }) => {
      const isGenericPhaseText = /^Turn \d+ - Thinking\.\.\.$/.test(text || '')
        || /^Turn \d+ [—-] Response received$/.test(text || '');
      if (text && !(isGenericPhaseText && activeToolPhaseRef.current)) {
        setStreamLabel(text);
      }
      if (status === 'error') pushActivity('error', text || 'Phase failed');
    },
    toolExecution: ({ toolName, args, argsObject }) => {
      const displayTool = getToolDisplayName(toolName);
      const cleanArgs = formatToolArgs(toolName, args, argsObject);
      const phaseLabel = getToolPhaseLabel(toolName);
      activeToolPhaseRef.current = phaseLabel;
      setStreamLabel(phaseLabel);
      pushActivity('tool', `${displayTool}(${truncate(cleanArgs, 50)})`);
    },
    toolResult: ({ toolName, text, fullText, isCollapsible, args }) => {
      const inlineDetails = shouldInlineToolDetails(toolName);
      const detailText = inlineDetails
        ? buildInlineToolDetailText(toolName, text, fullText, args)
        : buildInlineDetailText(fullText);
      const displayText = (text && text.trim()) ? text : (isCollapsible && fullText ? `${toolName || 'Result'} (${fullText.split('\n').length} lines)` : '');
      if (displayText) {
        pushActivity('status', displayText, {
          isCollapsible: !inlineDetails && isCollapsible,
          fullText: detailText,
          inlineDetails,
        });
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
        setPendingQuestion({ question, options: options || [], title: title || 'Action Required' });
        setPendingQuestionIndex(0);
        setPendingQuestionManualEntry(false);
        setInput('');
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
      const inputTokens = estimateMessageTokens(chatMessages);
      const safeMaxTokens = getSafeMaxTokens(inputTokens, model);
      const stream = await client.chat.completions.create({
        model: model.id, messages: chatMessages, temperature: model.temperature,
        top_p: model.topP, max_tokens: safeMaxTokens, stream: true, ...model.extraParams,
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

        const inputTokens = estimateMessageTokens(agentMessages);
        const safeMaxTokens = getSafeMaxTokens(inputTokens, model);
        const stream = await client.chat.completions.create({
          model: model.id, messages: agentMessages, temperature: model.temperature,
          top_p: model.topP, max_tokens: safeMaxTokens, stream: true, tools, ...model.extraParams,
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
              pushActivity('status', truncate(line, 100));
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

      const finalContent = execResult?.finalMessage?.content;
      return {
        type: 'assistant',
        text: typeof finalContent === 'string' ? finalContent : 'Agent completed.',
        id: nextId(),
      };
    } catch (error) {
      if (checkpoint) gitRestore(checkpoint);
      if (error.name === 'AbortError') return { type: 'system', text: 'Execution aborted.', id: nextId() };
      return { type: 'system', text: `Agent Error: ${error.message}`, id: nextId() };
    }
  }, [model, nextId]);

  const executeHandler = useCallback(async (query, activeMode = mode) => {
    const runToken = activeRunTokenRef.current + 1;
    activeRunTokenRef.current = runToken;
    setIsThinking(true);
    resetRunState(`${activeMode.label} running`);
    const reporter = buildReporter(activeMode);
    let resultMsg;
    let finalStatus = 'success';
    let finalLabel = `${activeMode.label} complete`;

    try {
      const msgSnapshot = [...messages];
      if (activeMode.value === 'ask') resultMsg = await runAskMode(query, msgSnapshot);
      else resultMsg = await runAgentMode(query, msgSnapshot, activeMode, reporter);

      if (resultMsg && currentActivityRef.current.length > 0) {
          resultMsg.activityLog = [...currentActivityRef.current];
      }

      if (resultMsg?.planFollowup === 'implement') {
        if (activeRunTokenRef.current !== runToken) return;
        setMessages((previous) => [...previous, resultMsg]);
        const implMode = { ...activeMode, label: 'Code', value: 'agent' };
        const implReporter = buildReporter(implMode);
        const implResult = await runAgentMode(`Implement the plan above.`, [...msgSnapshot, resultMsg], implMode, implReporter);
        if (implResult) implResult.activityLog = [...currentActivityRef.current];
        resultMsg = implResult;
      }

      if (resultMsg?.planFollowup === 'revise') {
        if (activeRunTokenRef.current !== runToken) return;
        setMessages((previous) => [...previous, resultMsg]);
        const reviseResult = await runAgentMode(resultMsg.text, [...msgSnapshot, resultMsg], activeMode, reporter);
        if (reviseResult) reviseResult.activityLog = [...currentActivityRef.current];
        resultMsg = reviseResult;
      }
    } catch (error) {
      finalStatus = 'error';
      finalLabel = `${activeMode.label} failed`;
      resultMsg = { type: 'system', text: `Error: ${error.message}`, id: nextId() };
    }

    if (resultMsg?.type === 'system') {
      finalStatus = 'error';
      if (resultMsg.text === 'Execution aborted.') finalLabel = 'Run interrupted';
      else if (resultMsg.text?.startsWith('API Error:')) finalLabel = `${activeMode.label} failed`;
      else if (resultMsg.text?.startsWith('Agent Error:')) finalLabel = `${activeMode.label} failed`;
      else if (!finalLabel || finalLabel.endsWith('complete')) finalLabel = `${activeMode.label} failed`;
    }

    if (activeRunTokenRef.current !== runToken) return;
    setMessages((previous) => [...previous, resultMsg]);
    finishRun(finalStatus, finalLabel);
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
      if (Array.isArray(pendingQuestion.options) && pendingQuestion.options.length > 0 && !pendingQuestionManualEntry) {
        resolvePendingQuestionAnswer(pendingQuestion.options[pendingQuestionIndex] || pendingQuestion.options[0]);
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) return;
      resolvePendingQuestionAnswer(trimmed);
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

    const normalizedTrimmed = trimmed.toLowerCase();

    if (/^\/model(\s|$)/.test(normalizedTrimmed)) {
      setInput('');

      const requestedModel = trimmed.slice(6).trim().toLowerCase();
      if (!requestedModel) {
        setPickerState({
          type: 'model',
          title: 'Select Model',
          items: availableModels.map((entry) => ({
            label: `${entry.name}${entry.key === model?.key || entry.id === model?.id ? ' (Current)' : ''}`,
            value: entry.key,
            key: `model-${entry.key}`,
            payload: entry,
          })),
        });
        return;
      }

      const matchedModel = availableModels.find((entry) =>
        entry.key.toLowerCase() === requestedModel
        || entry.name.toLowerCase() === requestedModel
        || entry.id.toLowerCase() === requestedModel
      );
      if (!matchedModel) {
        appendMessage('system', `Unknown model: ${requestedModel}`);
        return;
      }

      applyModelSwitch(matchedModel);
      return;
    }

    if (/^\/mode(\s|$)/.test(normalizedTrimmed)) {
      setInput('');

      const requestedMode = trimmed.slice(5).trim().toLowerCase();
      if (!requestedMode) {
        setPickerState({
          type: 'mode',
          title: 'Select Mode',
          items: availableModes.map((entry) => ({
            label: `${entry.label}${entry.value === mode?.value ? ' (Current)' : ''}`,
            value: entry.value,
            key: `mode-${entry.value}`,
            payload: entry,
          })),
        });
        return;
      }

      const matchedMode = availableModes.find((entry) =>
        entry.value.toLowerCase() === requestedMode || entry.label.toLowerCase() === requestedMode
      );
      if (!matchedMode) {
        appendMessage('system', `Unknown mode: ${requestedMode}`);
        return;
      }

      applyModeSwitch(matchedMode);
      return;
    }

    if (trimmed.toLowerCase() === '/expand' || trimmed.toLowerCase() === '/collapse' || trimmed.toLowerCase() === '/toggle') {
      toggleLatestCollapsible();
      setInput('');
      return;
    }

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
  }, [appendMessage, applyModeSwitch, applyModelSwitch, availableModels, availableModes, executeHandler, mode, model, nextId, onExit, pendingQuestion, pendingQuestionIndex, pendingQuestionManualEntry, resolveBuildCommand, resolvePendingQuestionAnswer, runGitShortcut, runUndoShortcut, toggleLatestCollapsible]);

  return {
    dims,
    messages,
    input, setInput,
    isThinking,
    elapsedTime,
    currentTurn,
    showQuestions, setShowQuestions,
    showShortcuts, setShowShortcuts,
    pickerState, setPickerState,
    handlePickerSelect,
    followLive, setFollowLive,
    scrollOffset,
    setScrollOffset,
    expandedBlocks,
    streamLabel,
    streamResponseContent,
    activityLog,
    liveTick,
    liveStatus,
    pendingQuestion,
    pendingQuestionIndex,
    pendingQuestionManualEntry,
    planFollowup, setPlanFollowup, planFollowupResolverRef,
    currentActivityRef,
    visibleCollapsibleIdRef,
    handleSubmit,
    toggleLatestCollapsible,
    pushActivity,
    stopActiveRun,
  };
}
