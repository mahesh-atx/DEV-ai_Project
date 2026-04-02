/**
 * Agent Controller — Interactive Tool Calling Pipeline
 * DevAI operates in a dynamic loop, acting and validating via tools.
 */

import { runPolishAgent } from "./polishAgent.js";
import { logErrorToFile } from "../utils/errorLog.js";
import { loadPrompt } from "../prompts/promptLoader.js";
import { loadToolPrompt } from "../tools/loader.js";
import { loadSoulPrompt, loadProviderPrompt } from "../prompts/systemPrompt.js";
import { buildInstructionPrompt } from "../prompts/instructionLoader.js";
import os from "os";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const KILO_DIR = join(PROJECT_ROOT, ".kilo");

function emitReporter(reporter, method, payload) {
  if (reporter && typeof reporter[method] === "function") {
    reporter[method](payload);
  }
}

function makeSpinner(reporter, phase, text) {
  emitReporter(reporter, "phaseStatus", { phase, status: "start", text });
  return {
    update(nextText) {
      emitReporter(reporter, "phaseStatus", { phase, status: "update", text: nextText });
    },
    succeed(nextText) {
      emitReporter(reporter, "phaseStatus", { phase, status: "success", text: nextText });
    },
    fail(nextText) {
      emitReporter(reporter, "phaseStatus", { phase, status: "error", text: nextText });
    },
    stop() {
      emitReporter(reporter, "phaseStatus", { phase, status: "stop", text });
    },
  };
}

function previewToolResult(result) {
  const firstLine = String(result || "").split("\n")[0] || "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

const OS_INFO = `Operating System: ${os.platform()} (${os.release()}).
If on Windows, use 'dir' instead of 'ls', and 'python' or 'py' instead of 'python3'.`;

const BASE_RULES = `
IMPORTANT RULES:
- Do NOT output files or commands in raw text/markdown blocks. You MUST use the exact tool calls.
- Always use the tools provided. Never stop without calling 'finish_task'.
- ANTI-LOOPING: If tests fail repeatedly due to environment setup, call 'finish_task' and boldly assume it works.
- NEVER use 'type' or 'cat' inside run_command to read files. ALWAYS use the 'read_file' tool natively.
- Prefer native file tools for exploration. Use 'list_files', 'search_files', 'search_content', and 'read_file' before reaching for shell commands.
- Prefer the 'cwd' argument on run_command for subdirectories instead of trying to use 'cd'.
- If a command fails, use the error output to fix your approach.
${OS_INFO}
`;

export const PROMPTS = {
  general: `You are DevAI — an Elite Autonomous AI Software Engineer.\nYour ultimate goal is to complete the user's request by intelligently calling tools.\n${BASE_RULES}`,
  explorer: `You are an Expert Codebase Explorer.\nYour goal is to aggressively search the codebase, read files, and output a detailed context architecture report. You cannot edit code.\n${BASE_RULES}`,
  coder: `You are an Elite Implementation Coder.\nYour goal is to execute specific file creations and edits cleanly based on the orchestrator's plan. You should not test code.\n${BASE_RULES}`,
  debugger: `You are a strict QA and Verification Debugger.\nYour goal is to run terminal tests, compile the codebase, analyze errors, and verify the work. You do not edit code.\n${BASE_RULES}`,
  plan: `You are a Lead AI Systems Architect meticulously operating in Plan Mode.\nYour objective is exclusively to explore the codebase and produce a comprehensive plan.\nYou operate in a strict read-only execution environment. You MUST NOT edit source code files or run terminal shell commands.\n\nYour 4-Phase Planning Workflow:\n1. Initial Understanding: Explore the codebase natively using list_files, search_files, search_content, and read_file.\n2. Design: Formulate a solution architecture.\n3. Review: Verify architectural feasibility.\n4. Final Plan: Respond with the complete plan as your text response (markdown format). The system will automatically save it to a .md file. Then call 'plan_exit' to signal completion.\n\nIMPORTANT: Do NOT use write_file to create the plan. Simply respond with the full plan text as your message content. The system handles file saving automatically.\n${BASE_RULES}`
};

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or completely overwrite a file. Use paths relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
          content: { type: "string", description: "The complete content of the file." }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Make surgical search-and-replace edits to an existing file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                search: { type: "string", description: "Exact matching text to replace. Must preserve leading whitespace." },
                replace: { type: "string", description: "The new text to insert." }
              },
              required: ["search", "replace"],
              additionalProperties: false
            }
          }
        },
        required: ["path", "edits"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a terminal command in the project directory or a subdirectory within it. Standard output and errors will be returned to you.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute." },
          cwd: { type: "string", description: "Optional working directory relative to the project root. Use this instead of 'cd'." }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories natively from the project root or a subdirectory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative path to list from. Defaults to the project root." },
          depth: { type: "integer", description: "Optional recursion depth. Defaults to 2." },
          includeHidden: { type: "boolean", description: "Whether to include hidden files and directories." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search the codebase for files or directories matching a name pattern. Supports plain text and glob patterns like '*.html'.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search query (e.g. 'auth', 'user.js', 'components/Btn')" }
        },
        required: ["pattern"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_content",
      description: "Search within files for exact text or regex patterns to explore the codebase.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text to search for." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the exact, complete contents of a file natively. Always use this instead of trying to run terminal commands to view files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish_task",
      description: "Call this tool when the task is fully completed or no further progress can be made.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "A summary message for the user explaining what was accomplished." }
        },
        required: ["message"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "plan_exit",
      description: "Signals that the planning phase is complete. Call this ONLY when the final plan is written to the .kilo/plans/ file and all user questions are answered.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Pause execution and explicitly ask the user a clarifying question before proceeding. Provide options for quick selection if applicable.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The specific question to ask the user." },
          options: { type: "array", items: { type: "string" }, description: "Optional list of predefined answer options for the user to select from." }
        },
        required: ["question"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delegate_task",
      description: "Delegate a pure-exploration or read task to a sub-agent. Returns the final report from the sub-agent.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Detailed instruction for the sub-agent to explore/read." }
        },
        required: ["task"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "task",
      description: "Spawn a completely isolated subagent to accomplish a complex coding or research step. The orchestrator must not edit code directly; it must delegate via this tool.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short 3-5 word summary." },
          prompt: { type: "string", description: "Full, detailed instructions and context for the subagent so it knows exactly what to do independently." },
          subagent_type: { type: "string", description: "The mode of the subagent: 'explorer', 'coder', or 'debugger'." },
          task_id: { type: "string", description: "Optional unique task ID." }
        },
        required: ["description", "prompt", "subagent_type"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "websearch",
      description: "Search the web for information using Exa AI. Returns relevant search results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query string." },
          numResults: { type: "integer", description: "Optional: Number of results to return (default: 8)." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "webfetch",
      description: "Fetch and download a specific URL content as markdown. Used to read documentation or web pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL to fetch (must start with http:// or https://)." }
        },
        required: ["url"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "multiedit",
      description: "Make multiple edits to a single file in one operation. Prefer this over edit_file when making several changes to the same file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                search: { type: "string", description: "Exact matching text to replace." },
                replace: { type: "string", description: "The new text to insert." },
                replaceAll: { type: "boolean", description: "Replace all occurrences." }
              },
              required: ["search", "replace"]
            }
          }
        },
        required: ["path", "edits"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "batch",
      description: "Execute multiple independent tool calls concurrently to reduce latency. Pass an array of tool calls to run in parallel.",
      parameters: {
        type: "object",
        properties: {
          tool_calls: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "The name of the tool to execute." },
                parameters: { type: "object", description: "Parameters for the tool." }
              },
              required: ["tool", "parameters"]
            },
            description: "Array of tool calls to execute in parallel (max 25)."
          }
        },
        required: ["tool_calls"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "codesearch",
      description: "Search for API, library, and SDK documentation context using Exa Code API.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for APIs, libraries, SDKs." },
          tokensNum: { type: "number", description: "Number of tokens to return (1000-50000)." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todowrite",
      description: "Create and manage a structured task list for the current coding session.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "Brief description of the task." },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
                priority: { type: "string", enum: ["high", "medium", "low"] }
              },
              required: ["content", "status", "priority"]
            }
          }
        },
        required: ["todos"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todoread",
      description: "Read the current to-do list for the session.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "codebase_search",
      description: "Search the codebase using natural language to find features or understand how things work.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  }
];

function getToolsForRole(role) {
  const universal = ["ask_user", "delegate_task"];
  if (role === 'explorer') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "finish_task", "codesearch", "codebase_search", "todoread", "todowrite", ...universal].includes(t.function.name));
  if (role === 'coder') return TOOLS_SCHEMA.filter(t => ["write_file", "edit_file", "multiedit", "read_file", "finish_task", "todoread", "todowrite", ...universal].includes(t.function.name));
  if (role === 'debugger') return TOOLS_SCHEMA.filter(t => ["run_command", "read_file", "finish_task", "todoread", "todowrite", ...universal].includes(t.function.name));
  if (role === 'plan') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "write_file", "plan_exit", ...universal].includes(t.function.name));
  if (role === 'orchestrator') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "run_command", "ask_user", "task", "websearch", "webfetch", "finish_task", "batch", "todoread", "todowrite"].includes(t.function.name));
  return TOOLS_SCHEMA.filter(t => t.function.name !== 'task');
}

/**
 * Execute a single tool call and return the result string
 */
async function executeToolCall(toolName, toolArgs, runtime, role, smartContext, reporter) {
  if (toolName === "read_file") {
    return runtime.readFile(toolArgs.path);
  }
  if (toolName === "list_files") {
    const listPath = toolArgs.path || ".";
    if (typeof runtime.listFiles === "function") {
      const results = await runtime.listFiles(listPath, toolArgs.depth, toolArgs.includeHidden);
      return results.length > 0 ? `Entries:\n${results.join('\n')}` : "No entries found.";
    }
    return "Error: list_files tool not registered.";
  }
  if (toolName === "search_files") {
    if (typeof runtime.searchFiles === 'function') {
      const results = await runtime.searchFiles(toolArgs.pattern);
      return results.length > 0 ? `Found files:\n${results.join('\n')}` : "No matching files found.";
    }
    return "Error: search_files tool not registered.";
  }
  if (toolName === "search_content") {
    if (typeof runtime.searchContent === 'function') {
      const results = await runtime.searchContent(toolArgs.query);
      return results.length > 0 ? `Found occurrences:\n${results.join('\n')}` : "No matches found.";
    }
    return "Error: search_content tool not registered.";
  }
  if (toolName === "run_command") {
    const output = await runtime.runCommand(toolArgs.command, toolArgs.cwd, { reporter, silent: true });
    if (output && typeof output.logs === 'string') return output.logs || "Command executed with no output.";
    if (output && (typeof output.stdout === 'string' || typeof output.stderr === 'string')) {
      const out = (output.stdout || '').trim();
      const err = (output.stderr || '').trim();
      if (out && !err) return out;
      if (!out && err) return err;
      if (out && err) return `${out}\n${err}`;
      return `Command exited with code ${output.status ?? 'unknown'}.`;
    }
    return "Command executed.";
  }
  if (toolName === "websearch") {
    const { websearch } = await import("../utils/webTools.js");
    const res = await websearch(toolArgs.query, toolArgs.numResults || 8);
    if (res.error) return `Error: ${res.error}`;
    return JSON.stringify(res.results, null, 2);
  }
  if (toolName === "webfetch") {
    const { webfetch } = await import("../utils/webTools.js");
    const res = await webfetch(toolArgs.url);
    if (res.error) return `Error: ${res.error}`;
    return res.content;
  }
  return `Tool ${toolName} not supported in batch mode.`;
}

/**
 * Build multi-layer system prompt (KiloCode-style)
 * Layers: soul.txt + provider_prompt(model) + environment() + instructionFiles() + agent_prompt
 */
async function buildSystemPrompt(role, modelConfig, extraContext, projectRoot) {
  const layers = [];

  // Layer 1: Soul (core personality)
  const soul = loadSoulPrompt();
  if (soul) layers.push(soul);

  // Layer 2: Provider-specific prompt
  const providerPrompt = loadProviderPrompt(modelConfig?.model || '');
  if (providerPrompt) layers.push(providerPrompt);

  // Layer 3: Environment info
  layers.push(`Environment:\n- Working directory: ${projectRoot || process.cwd()}\n- Platform: ${os.platform()} ${os.release()}\n- OS: ${os.type()}`);

  // Layer 4: Instruction files (AGENTS.md, CLAUDE.md)
  try {
    const instructionPrompt = await buildInstructionPrompt(projectRoot || process.cwd());
    if (instructionPrompt) layers.push(instructionPrompt);
  } catch (e) {
    // Skip if instruction loading fails
  }

  // Layer 5: Agent-specific prompt
  const agentPrompt = loadPrompt(role, modelConfig || {}, extraContext);
  if (agentPrompt) layers.push(agentPrompt);

  return layers.join('\n\n---\n\n');
}

/**
 * Interactive Open-Ended Tool execution loop
 */
export async function runAgentPipeline(userInput, smartContext, runtime, options = {}) {
  const role = options.role || "general";
  const reporter = options.reporter || runtime.reporter || null;
  const extraContext = options.extraContext || {};
  const projectRoot = options.projectRoot || process.cwd();
  const systemPrompt = await buildSystemPrompt(role, runtime.modelConfig || {}, extraContext, projectRoot);
  const activeTools = getToolsForRole(role);

  const startTime = Date.now();
  const phase = role === 'general' ? 'building' : role === 'explorer' ? 'exploring' : role === 'debugger' ? 'debugging' : 'coding';
  const phaseLabel = `Agent Loop [${role.toUpperCase()}]`;
  emitReporter(reporter, "phaseHeader", { phase, label: phaseLabel, role });

  let agentMessages = [
    { role: "system", content: systemPrompt + "\n\nEnvironment Context:\n" + smartContext },
    { role: "user", content: `<system-reminder>\nYour operational mode has changed from plan to code.\nYou are no longer in read-only mode.\nYou are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.\n</system-reminder>\n\n` + userInput }
  ];

  let isFinished = false;
  let finalMessage = null;
  let loopCount = 0;
  const MAX_LOOPS = 25;
  let totalTokens = 0;

  let statsFilesCreated = 0;
  let statsFilesEdited = 0;
  let statsCommandsRun = 0;
  let statsErrors = 0;

  while (!isFinished && loopCount < MAX_LOOPS) {
    loopCount++;

    let currentTools = activeTools;

    if (loopCount === MAX_LOOPS - 1) {
      agentMessages.push({
        role: "user",
        content: "<system-reminder>\nCRITICAL - MAXIMUM STEPS REACHED\n\nThe maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.\n\nSTRICT REQUIREMENTS:\n1. Do NOT make any tool calls\n2. MUST provide a text response summarizing work done so far\n3. This constraint overrides ALL other instructions\n\nResponse must include:\n- Statement that maximum steps have been reached\n- Summary of what has been accomplished\n- List of remaining tasks\n- Recommendations for next steps\n\nAny attempt to use tools is a critical violation. Respond with text ONLY.\n</system-reminder>"
      });
      currentTools = [];
    }

    const spinner = makeSpinner(reporter, phase, `Turn ${loopCount} - Thinking...`);

    let response;
    try {
      response = await runtime.callAI(agentMessages, currentTools);
      spinner.succeed(`Turn ${loopCount} — Response received`);
    } catch (err) {
      spinner.fail(`Turn ${loopCount} — ${err.message}`);
      statsErrors++;
      break;
    }

    if (!response) {
      spinner.stop();
      emitReporter(reporter, "log", { level: "warning", message: "Empty response." });
      break;
    }

    agentMessages.push(response);

    if (response.content) {
      emitReporter(reporter, "log", { level: "chat", message: response.content });
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        if (!tc || !tc.function || !tc.function.name) continue;

        let args;
        try {
          args = runtime.parseJSON(tc.function.arguments) || JSON.parse(tc.function.arguments);
        } catch (e) {
          emitReporter(reporter, "log", { level: "error", message: `Error parsing arguments for ${tc.function.name}` });
          agentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Execution Failed: Could not parse arguments JSON.`
          });
          continue;
        }

        const argsArray = Object.keys(args || {}).map(k => `${k}="${String(args[k]).substring(0, 30)}"`);
        emitReporter(reporter, "toolExecution", {
          toolName: tc.function.name,
          args: argsArray.join(', '),
        });

        let toolResultStr = "";

        try {
          if (tc.function.name === "write_file") {
            if (role === 'plan' && !args.path.replace(/\\/g, '/').match(/\.kilo\/plans\/.*\.md$/)) {
               toolResultStr = `Error: write_file permission denied. In Plan mode, you may ONLY write to the '.kilo/plans/' directory with a '.md' extension.`;
               statsErrors++;
            } else {
               runtime.patchFile(args.path, args.content, undefined, { reporter, silent: true });
               toolResultStr = `Successfully wrote ${args.path}`;
               statsFilesCreated++;
            }
          }
          else if (tc.function.name === "edit_file") {
            if (role === 'plan') {
               toolResultStr = `Error: edit_file permission denied in Plan mode. You must only create new files in '.kilo/plans/' using write_file.`;
               statsErrors++;
            } else {
               runtime.patchFile(args.path, null, args.edits, { reporter, silent: true });
               toolResultStr = `Successfully edited ${args.path}`;
               statsFilesEdited++;
            }
          }
          else if (tc.function.name === "run_command") {
            const output = await runtime.runCommand(args.command, args.cwd, { reporter, silent: true });
            statsCommandsRun++;

            if (output && typeof output.logs === 'string') {
               toolResultStr = output.logs || "Command executed with no output.";
            } else if (output && (typeof output.stdout === 'string' || typeof output.stderr === 'string')) {
               const out = (output.stdout || '').trim();
               const err = (output.stderr || '').trim();
               if (out && !err) toolResultStr = out;
               else if (!out && err) toolResultStr = err;
               else if (out && err) toolResultStr = `${out}\n${err}`;
               else toolResultStr = `Command exited with code ${output.status ?? 'unknown'}.`;
            } else if (typeof output === 'string') {
               toolResultStr = output;
            } else {
               toolResultStr = "Command executed.";
            }
           }
           else if (tc.function.name === "list_files") {
            const listPath = args.path || ".";
            if (typeof runtime.listFiles === "function") {
              const results = await runtime.listFiles(listPath, args.depth, args.includeHidden);
              toolResultStr = results.length > 0 ? `Entries:\n${results.join('\n')}` : "No entries found.";
            } else {
              toolResultStr = "Error: list_files tool not registered in runtime.";
            }
          }
          else if (tc.function.name === "search_files") {
            if (typeof runtime.searchFiles === 'function') {
              const results = await runtime.searchFiles(args.pattern);
              toolResultStr = results.length > 0 ? `Found files:\n${results.join('\n')}` : "No matching files found.";
            } else {
              toolResultStr = "Error: search_files tool not registered in runtime.";
            }
          }
          else if (tc.function.name === "search_content") {
            if (typeof runtime.searchContent === 'function') {
              const results = await runtime.searchContent(args.query);
              toolResultStr = results.length > 0 ? `Found occurrences:\n${results.join('\n')}` : "No matches found.";
            } else {
              toolResultStr = "Error: search_content tool not registered in runtime.";
            }
          }
          else if (tc.function.name === "read_file") {
            try {
               const content = runtime.readFile(args.path);
               toolResultStr = content;
            } catch (err) {
               toolResultStr = `Error reading file: ${err.message}`;
            }
          }
          else if (tc.function.name === "finish_task") {
            finalMessage = Object.assign({}, response, {
               content: response.content ? `${response.content}\n\nTask Finished: ${args.message}` : `Task Finished: ${args.message}`
            });
            isFinished = true;
            toolResultStr = "Task finished successfully.";
            emitReporter(reporter, "log", { level: "success", message: `Task complete: ${args.message}` });
          }
          else if (tc.function.name === "plan_exit") {
            finalMessage = Object.assign({}, response, {
               content: response.content && response.content.trim().length > 10
                 ? response.content
                 : `Plan completed. The full plan has been generated and saved.`
            });
            isFinished = true;
            toolResultStr = "Plan finished successfully.";
            emitReporter(reporter, "log", { level: "success", message: "Plan phase complete." });
          }
          else if (tc.function.name === "ask_user") {
            const questionOptions = Array.isArray(args.options) ? args.options : [];
            if (typeof reporter?.askUser === 'function') {
              emitReporter(reporter, "log", { level: "info", message: `Agent asks: ${args.question}` });
              toolResultStr = await reporter.askUser({ question: args.question, options: questionOptions });
            } else {
              toolResultStr = `Error: ask_user requires a TUI reporter with askUser handler.`;
              statsErrors++;
            }
          }
          else if (tc.function.name === "websearch") {
            const { websearch } = await import("../utils/webTools.js");
            const res = await websearch(args.query, args.numResults || 8);
            if (res.error) toolResultStr = `Error: ${res.error}`;
            else toolResultStr = JSON.stringify(res.results, null, 2);
          }
          else if (tc.function.name === "webfetch") {
            const { webfetch } = await import("../utils/webTools.js");
            const res = await webfetch(args.url);
            if (res.error) toolResultStr = `Error: ${res.error}`;
            else toolResultStr = res.content;
          }
          else if (tc.function.name === "task") {
            emitReporter(reporter, "log", { level: "info", message: `Delegating ${args.subagent_type}: ${args.description}` });
            
            const subResult = await runAgentPipeline(
               `[ORCHESTRATOR DELEGATION]: ${args.description}\n\nTask Prompt:\n${args.prompt}`, 
               smartContext, 
               runtime, 
               { role: args.subagent_type || "coder", reporter }
            );
            
            toolResultStr = `<task_result task_id="${args.task_id || ''}">\n\nSub-Agent Completed.\nFinal Output:\n${subResult.finalMessage?.content || "No output"}\n\n</task_result>`;
            emitReporter(reporter, "log", { level: "success", message: `Delegation finished: ${args.description}` });
          }
          else if (tc.function.name === "delegate_task") {
            emitReporter(reporter, "log", { level: "info", message: "Delegating explorer task..." });
            const subResult = await runAgentPipeline(args.task, smartContext, runtime, { role: "explorer", reporter });
            toolResultStr = `Sub-agent completed task.\n\nFinal Report:\n${subResult.finalMessage?.content || "No output"}`;
            emitReporter(reporter, "log", { level: "success", message: "Explorer task finished." });
          }
          else if (tc.function.name === "multiedit") {
            if (role === 'plan') {
              toolResultStr = `Error: multiedit permission denied in Plan mode.`;
              statsErrors++;
            } else {
              runtime.patchFile(args.path, null, args.edits.map(e => ({ search: e.search, replace: e.replace })), { reporter, silent: true });
              toolResultStr = `Successfully applied ${args.edits.length} edits to ${args.path}`;
              statsFilesEdited++;
            }
          }
          else if (tc.function.name === "batch") {
            const toolCalls = args.tool_calls || [];
            const results = [];
            const maxBatch = 25;
            const limitedCalls = toolCalls.slice(0, maxBatch);
            
            for (const call of limitedCalls) {
              try {
                const innerResult = await executeToolCall(call.tool, call.parameters, runtime, role, smartContext, reporter);
                results.push({ tool: call.tool, success: true, result: innerResult });
              } catch (err) {
                results.push({ tool: call.tool, success: false, error: err.message });
              }
            }
            
            const successCount = results.filter(r => r.success).length;
            toolResultStr = `Batch execution: ${successCount}/${results.length} tools succeeded.\n${results.map(r => r.success ? `✓ ${r.tool}: ${previewToolResult(r.result)}` : `✗ ${r.tool}: ${r.error}`).join('\n')}`;
          }
          else if (tc.function.name === "codesearch") {
            const { codesearch } = await import("../utils/webTools.js");
            const res = await codesearch(args.query, args.tokensNum || 5000);
            if (res.error) toolResultStr = `Error: ${res.error}`;
            else toolResultStr = res.content || JSON.stringify(res, null, 2);
          }
          else if (tc.function.name === "todowrite") {
            try {
              mkdirSync(KILO_DIR, { recursive: true });
              const todosPath = join(KILO_DIR, "todos.json");
              writeFileSync(todosPath, JSON.stringify(args.todos, null, 2));
              toolResultStr = `Todo list updated with ${args.todos.length} items.`;
            } catch (err) {
              toolResultStr = `Error writing todos: ${err.message}`;
              statsErrors++;
            }
          }
          else if (tc.function.name === "todoread") {
            try {
              const todosPath = join(KILO_DIR, "todos.json");
              if (existsSync(todosPath)) {
                const todos = JSON.parse(readFileSync(todosPath, 'utf-8'));
                toolResultStr = JSON.stringify(todos, null, 2);
              } else {
                toolResultStr = "No todos found.";
              }
            } catch (err) {
              toolResultStr = `Error reading todos: ${err.message}`;
              statsErrors++;
            }
          }
          else if (tc.function.name === "codebase_search") {
            toolResultStr = "codebase_search requires Morph API key. Set MORPH_API_KEY environment variable to enable.";
          } else {
            toolResultStr = `Error: Unknown tool ${tc.function.name}`;
          }
        } catch (err) {
          emitReporter(reporter, "log", { level: "error", message: `Error running tool ${tc.function.name}: ${err.message}` });
          toolResultStr = `Error executing tool: ${err.message}`;
          statsErrors++;
        }

        emitReporter(reporter, "toolResult", {
          toolName: tc.function.name,
          text: previewToolResult(toolResultStr),
        });

        agentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResultStr
        });
      }
    } else {
      finalMessage = response;
      isFinished = true;
    }
  }

  if (loopCount >= MAX_LOOPS) {
    emitReporter(reporter, "log", { level: "error", message: `Max loop count reached (${MAX_LOOPS}).` });
  }

  if (options.autoPolish && runtime.buildFreshContext) {
    emitReporter(reporter, "log", { level: "info", message: "Running auto-polish pass..." });
    try {
      const polishContext = runtime.buildFreshContext("improve code quality UI UX polish");
      const polishRuntime = {
        callAI: async (prompt) => {
          const polishMessages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ];
          const response = await runtime.callAI(polishMessages);
          return response?.content || "";
        },
        parseJSON: runtime.parseJSON,
        reporter,
        silent: true,
      };
      const polishResult = await runPolishAgent(polishContext, polishRuntime);
      if (polishResult && polishResult.files) {
        emitReporter(reporter, "log", { level: "success", message: `Auto-polish improved ${polishResult.files.length} file(s)` });
        for (const f of polishResult.files) {
          if (!f.path) continue;
          if (f.edits && Array.isArray(f.edits)) {
            runtime.patchFile(f.path, null, f.edits, { reporter, silent: true });
          } else if (typeof f.content === "string") {
            runtime.patchFile(f.path, f.content, undefined, { reporter, silent: true });
          }
        }
      } else {
        emitReporter(reporter, "log", { level: "info", message: "Auto-polish found no improvements." });
      }
    } catch (err) {
      emitReporter(reporter, "log", { level: "warning", message: `Auto-polish failed: ${err.message}` });
      logErrorToFile(err, "Auto-Polish");
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  const summary = {
    filesCreated: statsFilesCreated,
    filesEdited: statsFilesEdited,
    commandsRun: statsCommandsRun,
    errors: statsErrors,
    duration: `${duration}s`,
    loopCount,
  };

  emitReporter(reporter, "summary", summary);

  return { finalMessage, totalTokens };
}

export default runAgentPipeline;
