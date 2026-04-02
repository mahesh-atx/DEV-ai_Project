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

const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
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
  if (change?.action === 'create') return `Created ${path}`;
  if (change?.action === 'edit') return `Edited ${path} (${change.applied || 0} applied)`;
  if (change?.action === 'patch') return `Patched ${path}`;
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
  const [thinkFrame, setThinkFrame] = useState(0);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [customBuildCmd, setCustomBuildCmd] = useState('');
  
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showQuestions, setShowQuestions] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);

  const [streamLabel, setStreamLabel] = useState('Waiting for input');
  const [streamResponseContent, setStreamResponseContent] = useState('');
  const [activityLog, setActivityLog] = useState([]);

  const [pendingQuestion, setPendingQuestion] = useState(null);
  const questionResolverRef = useRef(null);
  const [planFollowup, setPlanFollowup] = useState(null);
  const planFollowupResolverRef = useRef(null);

  const startTimeRef = useRef(null);
  const clientRef = useRef(null);
  const isThinkingRef = useRef(false);
  const msgIdCounter = useRef(0);
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

  useEffect(() => {
    const handleResize = () => setDims({ rows: stdout.rows, columns: stdout.columns });
    stdout.on('resize', handleResize);
    return () => stdout.off('resize', handleResize);
  }, [stdout]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking) return undefined;
    const timer = setInterval(() => {
      setThinkFrame((frame) => (frame + 1) % THINKING_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [isThinking]);

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

  const pushActivity = useCallback((kind, text) => {
    // Claude code keeps complete traces in memory, so no slicing here
    const message = text.replace(/\n/g, ' ').trim(); // keep it single line
    if (!message) return;
    currentActivityRef.current = [...currentActivityRef.current, { kind, text: truncate(message, 140) }];
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

  const buildReporter = useCallback((activeMode) => createTuiReporter({
    phaseHeader: ({ label }) => {
      setStreamLabel(label || `${activeMode.label} running`);
    },
    phaseStatus: ({ status, text }) => {
      if (text) setStreamLabel(text);
      if (status === 'error') pushActivity('error', text || 'Phase failed');
    },
    toolExecution: ({ toolName, args }) => {
      let displayTool = 'Task';
      if (toolName === 'run_command') displayTool = 'Bash';
      else if (toolName === 'read_file') displayTool = 'Read';
      else if (toolName === 'write_file') displayTool = 'Write';
      else if (toolName === 'search_files') displayTool = 'Search';
      else if (toolName === 'ask_user') displayTool = 'Ask';
      
      let cleanArgs = args || '';
      if (typeof cleanArgs === 'string' && cleanArgs.startsWith('{')) {
          try { 
              const p = JSON.parse(cleanArgs); 
              if (toolName === 'run_command' && p.command) cleanArgs = p.command;
              else if (toolName === 'write_file' && p.path) cleanArgs = p.path;
              else if (toolName === 'read_file' && p.path) cleanArgs = p.path;
              else cleanArgs = Object.values(p)[0] || ''; 
          } catch(e){}
      }
      pushActivity('tool', `${displayTool}(${truncate(cleanArgs, 50)})`);
    },
    toolResult: ({ toolName, text }) => {
      if (text && text.trim()) {
        pushActivity('status', text);
      }
    },
    fileChange: (change) => {
      pushActivity(change.status === 'error' ? 'error' : 'success', summarizeFileChange(change));
    },
    commandPreview: ({ command }) => {
       pushActivity('command', `Bash(${truncate(command, 60)})`);
    },
    commandResult: ({ outcome, preview }) => {
       pushActivity(outcome === 'failed' || outcome === 'blocked' ? 'error' : 'status', preview || outcome);
    },
    summary: (partial) => {
      updateSummary(partial);
      if (partial && partial.loopCount !== undefined) {
        setCurrentTurn(partial.loopCount);
      }
    },
    log: ({ level, message }) => {
      pushActivity(level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'status', message);
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
  }), [pushActivity, updateSummary]);

  // Standard LLM Execution logic wrappers
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
      { default: runAgentPipeline }, { buildSmartContext }, { patchFile }, { runCommands },
      { gitCheckpoint, gitRestore, gitDiscard }, { listWorkspaceEntries, searchWorkspaceFiles, searchWorkspaceContent },
      path, fs, { parseJSON }, policyModule
    ] = await Promise.all([
      import('../../engine/agentController.js'), import('../../engine/context.js'), import('../../engine/patchEngine.js'), import('../../engine/commandExecutor.js'),
      import('../../utils/git.js'), import('../../utils/fileTools.js'), import('path'), import('fs'), import('../../engine/jsonParser.js'),
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
            timeout: policy.commandTimeoutMs || 300000,
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
      searchFiles: async (pattern) => searchWorkspaceFiles(projectDir, pattern),
      searchContent: async (searchText) => searchWorkspaceContent(projectDir, searchText),
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
        
        if (checkpoint) gitDiscard(checkpoint);
        
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
      if (checkpoint) gitDiscard(checkpoint);

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

      // Attach tool trace to the message so it stays in scrollback
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

  const handleSubmit = useCallback((value) => {
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
      
      setMessages((previous) => [...previous, { type: 'user', text: answer, id: nextId() }]);
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

    let activeMode = mode;
    let query = trimmed;
    if (trimmed.startsWith('/plan')) { activeMode = MODE_MAP.planner; query = trimmed.slice(5).trim() || 'Create a plan.'; }
    else if (trimmed.startsWith('/polish')) { activeMode = MODE_MAP.polish; query = trimmed.slice(7).trim() || 'Improve code.'; }
    else if (trimmed.startsWith('/agent')) { activeMode = MODE_MAP.agent; query = trimmed.slice(6).trim(); }
    else if (trimmed.startsWith('/ask')) { activeMode = MODE_MAP.ask; query = trimmed.slice(4).trim(); }

    setMessages((previous) => [...previous, { type: 'user', text: trimmed, id: nextId() }]);
    setInput('');
    setScrollOffset(0);
    executeHandler(query, activeMode);
  }, [executeHandler, mode, nextId, onExit, pendingQuestion]);

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

  // Unified rendering engine to simulate Claude Code inline logging
  const maxLineWidth = Math.max(20, dims.columns - 4);
  const allLines = useMemo(() => {
    let lines = [];

    messages.forEach((msg) => {
      if (msg.type === 'system') {
         if (msg.id === 'init') {
            // We now use a fixed header instead of an inline init message, so we skip it here.
            return;
         } else {
            wrapText(msg.text, maxLineWidth).forEach(l => lines.push({ text: l, color: THEME.dim }));
         }
         lines.push({ text: '', empty: true });
         lines.push({ text: '', empty: true }); // Extra spacing
      } else if (msg.type === 'user') {
         wrapText(`> ${msg.text}`, maxLineWidth).forEach((l, i) => {
            lines.push({ text: l, color: THEME.text, bold: i === 0 });
         });
         lines.push({ text: '', empty: true });
         lines.push({ text: '', empty: true }); // Extra spacing
      } else {
         // Tool trace rendering mimicking Claude Code
         if (msg.activityLog && msg.activityLog.length > 0) {
             msg.activityLog.forEach(entry => {
                 const isSub = entry.kind === 'status' || entry.kind === 'success' || entry.kind === 'error';
                 const isTool = entry.kind === 'tool' || entry.kind === 'command';
                 const icon = isSub ? '  └ ' : '● ';
                 const color = entry.kind === 'error' ? THEME.error : (isTool ? THEME.success : THEME.text);
                 
                 wrapText(`${icon}${entry.text}`, maxLineWidth).forEach((l, i) => {
                     lines.push({ text: i === 0 ? l : `    ${l}`, color: i === 0 ? color : THEME.dim });
                 });
             });
             lines.push({ text: '', empty: true });
         }

         if (msg.planFollowup && msg.planFollowup !== 'none') {
             const planContent = msg.text.replace(/^## Plan: .*\n\n/, '').replace(/\n\n---\n\n[\s\S]*$/, '').trim();
             lines.push({ text: '✓ PLAN COMPLETE', color: THEME.warning, bold: true });
             wrapText(planContent, maxLineWidth).forEach(l => lines.push({ text: l, color: THEME.text }));
             if (msg.planFollowup === 'implement') lines.push({ text: '→ Implementing in this session...', color: THEME.success });
             else if (msg.planFollowup === 'new_session') lines.push({ text: '✦ Plan saved for next session.', color: THEME.dim });
         } else if (msg.text) {
             let inCodeBlock = false;
             wrapText(msg.text, maxLineWidth).forEach(l => {
                 if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
                 lines.push({ text: l, color: inCodeBlock ? '#E5C07B' : THEME.text });
             });
         }
         lines.push({ text: '', empty: true });
         lines.push({ text: '', empty: true }); // Extra spacing
      }
    });

    // Active streaming logic
    if (isThinking) {
       // Live Tool Trace
       activityLog.forEach(entry => {
           const isSub = entry.kind === 'status' || entry.kind === 'success' || entry.kind === 'error';
           const isTool = entry.kind === 'tool' || entry.kind === 'command';
           const icon = isSub ? '  └ ' : '● ';
           const color = entry.kind === 'error' ? THEME.error : (isTool ? THEME.success : THEME.text);
           wrapText(`${icon}${entry.text}`, maxLineWidth).forEach((l, i) => {
               lines.push({ text: i === 0 ? l : `    ${l}`, color: i === 0 ? color : THEME.dim });
           });
       });

       // Live Response Body
       if (streamResponseContent) {
           lines.push({ text: '', empty: true });
           let inCodeBlock = false;
           wrapText(streamResponseContent, maxLineWidth).forEach(l => {
               if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
               lines.push({ text: l, color: inCodeBlock ? '#E5C07B' : THEME.text });
           });
       }

       // Claude-style active loader
       lines.push({ text: '', empty: true });
       const spinner = THINKING_FRAMES[thinkFrame];
       lines.push({ text: `${spinner} ${streamLabel}...... (esc to interrupt)`, color: THEME.dim });
    }

    while (lines.length > 0 && lines[lines.length - 1].empty) {
        lines.pop();
    }
    return lines;
  }, [messages, isThinking, activityLog, streamResponseContent, streamLabel, maxLineWidth, mode, model, thinkFrame, currentTurn]);

  // Dynamically calculate exact heights so the footer never gets pushed off
  let uiReservedLines = 8; // Header (5) + Input area/Footer (3)
  if (pendingQuestion) {
      const qStr = typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question;
      let qLinesCount = 0;
      qStr.split('\n').forEach(line => {
        // columns - 2(margin) - 2(border) - 2(padding)
        qLinesCount += wrapText(line, dims.columns - 6).length;
      });
      uiReservedLines += 6 + qLinesCount;
  }
  if (planFollowup) uiReservedLines += 9;

  const chatLinesAvailable = Math.max(5, dims.rows - uiReservedLines);
  const maxScroll = Math.max(0, allLines.length - chatLinesAvailable);
  const clampedScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const startIndex = Math.max(0, allLines.length - chatLinesAvailable - clampedScroll);
  const visibleLines = allLines.slice(startIndex, startIndex + chatLinesAvailable);

  if (showQuestions) {
    return (
      <Box flexDirection="column" height={dims.rows} width="100%" alignItems="center" justifyContent="center">
        <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={72}>
          <Text color={THEME.accent} bold marginBottom={1}>Select a Question</Text>
          <Box flexDirection="column" paddingX={2}>
            <SelectInput
              items={questionItems}
              onSelect={handleQuestionSelect}
              indicatorComponent={({ isSelected }) => <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '❯ ' : '  '}</Text>}
              itemComponent={({ isSelected, label }) => <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>{label}</Text>}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={dims.rows} width="100%">
      
      {/* Fixed Header */}
      <Box flexDirection="row" paddingX={1} paddingBottom={1} marginBottom={1} justifyContent="space-between">
        <Box flexDirection="row">
          <Box flexDirection="column" marginRight={2}>
            <Text color="#FF7979" bold> 🤖 </Text>
            <Text color="#FF7979" bold>▀▀▀</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold>DevAI Engine</Text>
            <Text color={THEME.dim}>{mode.label} • {model.name}</Text>
            <Text color={THEME.dim}>{process.cwd()}</Text>
          </Box>
        </Box>
        {scrollOffset > 0 && (
          <Box flexDirection="column" alignItems="flex-end">
            <Text color={THEME.accent} bold>↑ Scrolled {clampedScroll} ↑</Text>
          </Box>
        )}
      </Box>

      {/* Scrollable Chat Area */}
      <Box flexGrow={1} flexDirection="column" overflowY="hidden" paddingX={1} paddingTop={0}>
        {visibleLines.map((line, index) => (
          <Box key={index} flexDirection="row">
            <Text color={line.color} bold={line.bold}>{line.text}</Text>
          </Box>
        ))}
      </Box>

      {/* Claude-style Permission Box overlay */}
      {pendingQuestion && (
        <Box flexDirection="column" borderStyle="round" borderColor={pendingQuestion.title?.includes('Warning') ? THEME.error : THEME.accent} paddingX={1} marginX={1} marginBottom={1}>
          <Text color={pendingQuestion.title?.includes('Warning') ? THEME.error : THEME.accent} bold>{pendingQuestion.title || 'Action Required'}</Text>
          <Box flexDirection="column" marginTop={1} marginBottom={1}>
            {(typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question).split('\n').map((line, i) => {
              const isOption = line.trim().startsWith('>');
              return <Text key={i} color={isOption ? THEME.accent : THEME.text} bold={isOption}>{line}</Text>;
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

      {/* Input Area */}
      <Box flexDirection="row" paddingX={1} marginBottom={1}>
        <Box marginRight={1}>
          <Text color={THEME.text} bold>{'>'}</Text>
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

      {/* Footer minimal info strip */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text color={THEME.dim}>? for shortcuts</Text>
        <Text color={THEME.dim}>{isThinking ? 'Thinking on (tab to toggle)' : 'Thinking off (tab to toggle)'}</Text>
      </Box>
    </Box>
  );
};

export default ChatScreen;