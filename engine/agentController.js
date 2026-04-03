/**
 * Agent Controller — Interactive Tool Calling Pipeline
 * RootX operates in a dynamic loop, acting and validating via tools.
 */

import { runPolishAgent } from "./polishAgent.js";
import { logErrorToFile } from "../utils/errorLog.js";
import { loadPrompt } from "../prompts/promptLoader.js";
import { loadToolPrompt } from "../tools/loader.js";
import { loadSoulPrompt, loadProviderPrompt } from "../prompts/systemPrompt.js";
import { buildPromptRuntime } from "./prompt/index.js";
import { getTodoCounts, readTodoList, writeTodoList } from "../utils/todoStore.js";
import os from "os";
import { readFileSync, existsSync, statSync, realpathSync } from "fs";
import { join, dirname, extname, resolve } from "path";
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

function shouldCollapseToolResult(result) {
  const text = String(result || "");
  if (!text) return false;
  return text.includes("\n") || text.length > 160;
}

const TOOL_NAME_ALIASES = {
  bash: "run_command",
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
  list: "list_files",
  glob: "search_files",
  grep: "search_content",
  question: "ask_user",
  brief: "send_user_message",
};

function normalizeToolName(toolName) {
  return TOOL_NAME_ALIASES[toolName] || toolName;
}

function normalizeToolArgs(toolName, toolArgs = {}) {
  if (toolName === "bash") {
    return { command: toolArgs.command, cwd: toolArgs.workdir, timeout: toolArgs.timeout };
  }
  if (toolName === "read") {
    return { path: toolArgs.filePath, offset: toolArgs.offset, limit: toolArgs.limit };
  }
  if (toolName === "write") {
    return { path: toolArgs.filePath, content: toolArgs.content };
  }
  if (toolName === "edit") {
    return {
      path: toolArgs.filePath,
      search: toolArgs.oldString,
      replace: toolArgs.newString,
      replaceAll: toolArgs.replaceAll === true,
      edits: [{ search: toolArgs.oldString, replace: toolArgs.newString }],
    };
  }
  if (toolName === "list") {
    return { path: toolArgs.path };
  }
  if (toolName === "glob") {
    return { pattern: toolArgs.pattern, path: toolArgs.path };
  }
  if (toolName === "grep") {
    return { query: toolArgs.pattern, path: toolArgs.path, include: toolArgs.include };
  }
  return toolArgs;
}

function countContentLines(text) {
  const value = String(text || "");
  if (!value) return 0;
  return value.split("\n").length;
}

function countSectionItems(result, prefix) {
  const value = String(result || "");
  if (!value.startsWith(prefix)) return 0;
  const rest = value.slice(prefix.length).trim();
  if (!rest) return 0;
  return rest.split("\n").filter(Boolean).length;
}

function isImageAttachmentPath(filePath) {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extname(filePath).toLowerCase());
}

function resolveAttachment(projectRoot, attachmentPath) {
  const rawPath = String(attachmentPath || "").trim();
  if (!rawPath) {
    throw new Error("attachment paths must not be empty");
  }

  const resolvedPath = realpathSync(resolve(projectRoot || process.cwd(), rawPath));
  const metadata = statSync(resolvedPath);

  return {
    path: resolvedPath,
    size: metadata.size,
    is_image: isImageAttachmentPath(resolvedPath),
  };
}

function executeSendUserMessage(args = {}, projectRoot, reporter) {
  const message = String(args.message || "").trim();
  if (!message) {
    throw new Error("message must not be empty");
  }

  const status = args.status === "proactive" ? "proactive" : "normal";
  const attachments = Array.isArray(args.attachments)
    ? args.attachments.map((attachmentPath) => resolveAttachment(projectRoot, attachmentPath))
    : [];
  const sentAt = new Date().toISOString();

  emitReporter(reporter, "userMessage", {
    message,
    status,
    attachments,
    sentAt,
  });

  return {
    message,
    attachments: attachments.length > 0 ? attachments : null,
    sent_at: sentAt,
  };
}

function executeStructuredOutput(args = {}) {
  return {
    data: "Structured output provided successfully",
    structured_output: (args && typeof args === "object" && !Array.isArray(args)) ? args : {},
  };
}

function summarizeToolResult(toolName, toolResult, args = {}) {
  const resultText = String(toolResult || "");

  if (!resultText) return "";
  if (resultText.startsWith("Error")) return previewToolResult(resultText);

  if (toolName === "read_file") {
    const lineCount = countContentLines(resultText);
    const path = args.path || "file";
    return `Read ${lineCount} line${lineCount === 1 ? "" : "s"} from ${path}`;
  }

  if (toolName === "list_files") {
    const entryCount = countSectionItems(resultText, "Entries:\n");
    if (entryCount > 0) {
      return `Listed ${entryCount} path${entryCount === 1 ? "" : "s"}`;
    }
    return previewToolResult(resultText);
  }

  if (toolName === "search_files") {
    const matchCount = countSectionItems(resultText, "Found files:\n");
    if (matchCount > 0) {
      return `Found ${matchCount} matching file${matchCount === 1 ? "" : "s"}`;
    }
    return previewToolResult(resultText);
  }

  if (toolName === "search_content") {
    const matchCount = countSectionItems(resultText, "Found occurrences:\n");
    if (matchCount > 0) {
      return `Found ${matchCount} matching occurrence${matchCount === 1 ? "" : "s"}`;
    }
    return previewToolResult(resultText);
  }

  if (toolName === "send_user_message") {
    return `Sent ${args.status === "proactive" ? "proactive" : "normal"} message to user`;
  }

  if (toolName === "structured_output") {
    const keyCount = args && typeof args === "object" ? Object.keys(args).length : 0;
    return `Structured output (${keyCount} key${keyCount === 1 ? "" : "s"})`;
  }

  return previewToolResult(resultText);
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
- User-facing responses must be terminal-friendly plain text. Do not emit <think> blocks, markdown tables, or decorative emphasis like '**bold**'.
- Prefer short headings and simple '-' lists so the TUI can colorize and wrap them cleanly.
${OS_INFO}
`;

export const PROMPTS = {
  general: `You are RootX — an Elite Autonomous AI Software Engineer.\nYour ultimate goal is to complete the user's request by intelligently calling tools.\n${BASE_RULES}`,
  explorer: `You are an Expert Codebase Explorer.\nYour goal is to aggressively search the codebase, read files, and output a detailed context architecture report. You cannot edit code.\n${BASE_RULES}`,
  coder: `You are an Elite Implementation Coder.\nYour goal is to execute specific file creations and edits cleanly based on the orchestrator's plan. You should not test code.\n${BASE_RULES}`,
  debugger: `You are a strict QA and Verification Debugger.\nYour goal is to run terminal tests, compile the codebase, analyze errors, and verify the work. You do not edit code.\n${BASE_RULES}`,
  plan: `You are a Lead AI Systems Architect meticulously operating in Plan Mode.\nYour objective is exclusively to explore the codebase and produce a comprehensive plan.\nYou operate in a strict read-only execution environment. You MUST NOT edit source code files or run terminal shell commands.\n\nYour 4-Phase Planning Workflow:\n1. Initial Understanding: Explore the codebase natively using list_files, search_files, search_content, and read_file.\n2. Design: Formulate a solution architecture.\n3. Review: Verify architectural feasibility.\n4. Final Plan: Respond with the complete plan as plain structured terminal text. Use short headings and simple '-' lists. Do not use markdown tables, '**' emphasis, or code fences. The system will automatically save it to a .md file. Then call 'plan_exit' to signal completion.\n\nIMPORTANT: Do NOT use write_file to create the plan. Simply respond with the full plan text as your message content. The system handles file saving automatically.\n${BASE_RULES}`
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
      description: "Create and manage a structured task list for the current coding session. Use this at the start of non-trivial tasks, feature builds, or any work with 3 or more meaningful steps.",
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
      description: "Read the current to-do list for the session so you can continue work against the existing task plan.",
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
  },
  {
    type: "function",
    function: {
      name: "send_user_message",
      description: "Send a message to the user without blocking execution.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send to the user." },
          attachments: {
            type: "array",
            items: { type: "string" },
            description: "Optional attachment file paths."
          },
          status: {
            type: "string",
            enum: ["normal", "proactive"],
            description: "Message priority level."
          }
        },
        required: ["message", "status"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "structured_output",
      description: "Return structured machine-readable output.",
      parameters: {
        type: "object",
        additionalProperties: true
      }
    }
  }
];

TOOLS_SCHEMA.push(
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a terminal command in the project workspace.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute." },
          workdir: { type: "string", description: "Optional working directory relative to the project root." },
          timeout: { type: "number", description: "Optional timeout in milliseconds." },
          description: { type: "string", description: "Optional short description of the command." }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read a file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The path to the file to read." },
          offset: { type: "number", description: "Optional starting line number (1-based)." },
          limit: { type: "number", description: "Optional maximum number of lines to return." }
        },
        required: ["filePath"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write",
      description: "Create or overwrite a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The path to the file." },
          content: { type: "string", description: "The complete content to write." }
        },
        required: ["filePath", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit",
      description: "Replace text inside an existing file.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The path to the file." },
          oldString: { type: "string", description: "The text to replace." },
          newString: { type: "string", description: "The replacement text." },
          replaceAll: { type: "boolean", description: "Whether to replace all occurrences." }
        },
        required: ["filePath", "oldString", "newString"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Search the workspace for files matching a glob pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The glob pattern to match." },
          path: { type: "string", description: "Optional subdirectory to search from." }
        },
        required: ["pattern"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search inside files for matching text or regex.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The search text or regex." },
          path: { type: "string", description: "Optional subdirectory to search from." },
          include: { type: "string", description: "Optional file glob filter." }
        },
        required: ["pattern"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list",
      description: "List entries in a directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional directory to list." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "question",
      description: "Ask one or more questions and wait for the user's answers.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The question to ask." },
                header: { type: "string", description: "Short label for the question." },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Display label for the option." },
                      description: { type: "string", description: "Optional explanation." }
                    },
                    required: ["label"],
                    additionalProperties: false
                  }
                },
                multiple: { type: "boolean", description: "Whether multiple selections are allowed." }
              },
              required: ["question", "header", "options"],
              additionalProperties: false
            }
          }
        },
        required: ["questions"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "brief",
      description: "Send a message to the user without blocking execution.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send to the user." },
          attachments: {
            type: "array",
            items: { type: "string" },
            description: "Optional attachment file paths."
          },
          status: {
            type: "string",
            enum: ["normal", "proactive"],
            description: "Message priority level."
          }
        },
        required: ["message", "status"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lsp",
      description: "Use lightweight workspace-backed language intelligence.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"] },
          filePath: { type: "string", description: "The file path to inspect." },
          line: { type: "number", description: "The 1-based line number." },
          character: { type: "number", description: "The 1-based character offset." }
        },
        required: ["operation", "filePath", "line", "character"],
        additionalProperties: false
      }
    }
  }
);

function getToolsForRole(role, options = {}) {
  const allowTodoTools = options.allowTodoTools !== false;
  const universal = ["ask_user", "delegate_task", "send_user_message", "structured_output", "brief"];
  const todoTools = allowTodoTools ? ["todoread", "todowrite"] : [];

  if (role === 'explorer') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "finish_task", "codesearch", "codebase_search", "read", "glob", "grep", "list", "question", "lsp", ...todoTools, ...universal].includes(t.function.name));
  if (role === 'coder') return TOOLS_SCHEMA.filter(t => ["write_file", "edit_file", "multiedit", "read_file", "finish_task", "read", "write", "edit", "question", "lsp", ...todoTools, ...universal].includes(t.function.name));
  if (role === 'debugger') return TOOLS_SCHEMA.filter(t => ["run_command", "read_file", "finish_task", "bash", "read", "question", ...todoTools, ...universal].includes(t.function.name));
  if (role === 'plan') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "write_file", "plan_exit", "read", "glob", "grep", "list", "question", ...universal].includes(t.function.name));
  if (role === 'orchestrator') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "run_command", "ask_user", "task", "websearch", "webfetch", "finish_task", "batch", "bash", "read", "glob", "grep", "list", "question", ...todoTools, ...universal].includes(t.function.name));
  return TOOLS_SCHEMA.filter(t => t.function.name !== 'task' && (allowTodoTools || !["todowrite", "todoread"].includes(t.function.name)));
}

/**
 * Execute a single tool call and return the result string
 */
async function executeToolCall(toolName, toolArgs, runtime, role, smartContext, reporter) {
  const normalizedToolName = normalizeToolName(toolName);
  const normalizedArgs = normalizeToolArgs(toolName, toolArgs);

  if ((normalizedToolName === "todowrite" || normalizedToolName === "todoread") && runtime.allowTodoTools === false) {
    return "Error: todo tools are only available to the main agent.";
  }

  if (normalizedToolName === "read_file") {
    const content = runtime.readFile(normalizedArgs.path);
    const lines = String(content || "").split("\n");
    const offset = Math.max(1, Number(normalizedArgs.offset || 1));
    const limit = Number.isFinite(Number(normalizedArgs.limit)) ? Math.max(1, Number(normalizedArgs.limit)) : null;
    const sliced = limit ? lines.slice(offset - 1, offset - 1 + limit) : lines.slice(offset - 1);
    return sliced.join("\n");
  }
  if (normalizedToolName === "list_files") {
    const listPath = normalizedArgs.path || ".";
    if (typeof runtime.listFiles === "function") {
      const results = await runtime.listFiles(listPath, normalizedArgs.depth, normalizedArgs.includeHidden);
      return results.length > 0 ? `Entries:\n${results.join('\n')}` : "No entries found.";
    }
    return "Error: list_files tool not registered.";
  }
  if (normalizedToolName === "search_files") {
    if (typeof runtime.searchFiles === 'function') {
      const results = await runtime.searchFiles(normalizedArgs.pattern, { path: normalizedArgs.path });
      return results.length > 0 ? `Found files:\n${results.join('\n')}` : "No matching files found.";
    }
    return "Error: search_files tool not registered.";
  }
  if (normalizedToolName === "search_content") {
    if (typeof runtime.searchContent === 'function') {
      const results = await runtime.searchContent(normalizedArgs.query, { path: normalizedArgs.path, include: normalizedArgs.include });
      return results.length > 0 ? `Found occurrences:\n${results.join('\n')}` : "No matches found.";
    }
    return "Error: search_content tool not registered.";
  }
  if (normalizedToolName === "run_command") {
    const output = await runtime.runCommand(normalizedArgs.command, normalizedArgs.cwd, { reporter, silent: true, timeout: normalizedArgs.timeout });
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
  if (normalizedToolName === "websearch") {
    const { websearch } = await import("../utils/webTools.js");
    const res = await websearch(normalizedArgs.query, normalizedArgs.numResults || 8);
    if (res.error) return `Error: ${res.error}`;
    return JSON.stringify(res.results, null, 2);
  }
  if (normalizedToolName === "webfetch") {
    const { webfetch } = await import("../utils/webTools.js");
    const res = await webfetch(normalizedArgs.url);
    if (res.error) return `Error: ${res.error}`;
    return res.content;
  }
  if (toolName === "question") {
    if (typeof reporter?.askUser !== "function") {
      return "Error: question requires a TUI reporter with askUser handler.";
    }

    const answers = [];
    for (const question of normalizedArgs.questions || []) {
      const optionLabels = Array.isArray(question.options) ? question.options.map((option) => option.label) : [];
      const answer = await reporter.askUser({
        title: question.header || "Question",
        question: question.question,
        options: optionLabels,
      });
      answers.push({ header: question.header || "Question", answer });
    }

    return JSON.stringify(answers, null, 2);
  }
  if (toolName === "lsp") {
    if (typeof runtime.lsp === "function") {
      return runtime.lsp(normalizedArgs);
    }
    return "Error: lsp tool not registered.";
  }
  if (normalizedToolName === "send_user_message") {
    return JSON.stringify(
      executeSendUserMessage(normalizedArgs, runtime.projectRoot || process.cwd(), reporter),
      null,
      2
    );
  }
  if (normalizedToolName === "structured_output") {
    return JSON.stringify(executeStructuredOutput(normalizedArgs), null, 2);
  }
  if (normalizedToolName === "todowrite") {
    return JSON.stringify(writeTodoList(runtime.projectRoot || process.cwd(), normalizedArgs.todos), null, 2);
  }
  if (normalizedToolName === "todoread") {
    return JSON.stringify(readTodoList(runtime.projectRoot || process.cwd()), null, 2);
  }
  return `Tool ${toolName} not supported in batch mode.`;
}

const OUTPUT_STYLES = {
  orchestrator: {
    name: "Coordinated execution",
    prompt: "Coordinate complex work in waves, preserve file ownership boundaries, and keep user-facing narration concise and grounded in the workspace.",
  },
  plan: {
    name: "Architectural planning",
    prompt: "Stay read-first, tighten assumptions against the workspace, and produce implementation-ready plans without drifting into execution.",
  },
};

const TODO_TRACKING_SECTION = `# Task tracking
 - For any non-trivial coding task, feature build, multi-file change, or request that will take 3 or more meaningful steps, create a todo list immediately using 'todowrite' before doing the main implementation work.
 - After creating the todo list, mark exactly one task as 'in_progress' and keep the others pending until you reach them.
 - Update the todo list as you progress. Mark tasks completed immediately after finishing them and add follow-up tasks if the scope changes.
 - Use 'todoread' whenever you need to re-check the current plan before continuing.
 - Skip todo tools only for truly trivial one-step work or purely informational requests.`;

async function buildSystemPrompt(role, modelConfig, extraContext, projectRoot, options = {}) {
  const soul = loadSoulPrompt();
  const providerPrompt = loadProviderPrompt(modelConfig?.id || modelConfig?.model || '');
  const agentPrompt = loadPrompt(role, modelConfig || {}, extraContext);
  const appendSections = [soul, providerPrompt, agentPrompt];

  if (options.allowTodoTools !== false) {
    appendSections.push(TODO_TRACKING_SECTION);
  }

  const promptRuntime = buildPromptRuntime({
    role,
    modelConfig,
    projectRoot: projectRoot || process.cwd(),
    osName: os.platform(),
    osVersion: os.release(),
    outputStyle: OUTPUT_STYLES[role] || null,
    appendSections,
  });

  return promptRuntime.prompt;
}

/**
 * Interactive Open-Ended Tool execution loop
 */
export async function runAgentPipeline(userInput, smartContext, runtime, options = {}) {
  const role = options.role || "general";
  const allowTodoTools = options.allowTodoTools !== false;
  const reporter = options.reporter || runtime.reporter || null;
  const extraContext = options.extraContext || {};
  const projectRoot = options.projectRoot || process.cwd();
  const systemPrompt = await buildSystemPrompt(role, runtime.modelConfig || {}, extraContext, projectRoot, { allowTodoTools });
  const activeTools = getToolsForRole(role, { allowTodoTools });
  const batchRuntime = { ...runtime, allowTodoTools, projectRoot };

  const startTime = Date.now();
  const phase = role === 'general' ? 'building' : role === 'explorer' ? 'exploring' : role === 'debugger' ? 'debugging' : 'coding';
  const phaseLabel = `Agent Loop [${role.toUpperCase()}]`;
  emitReporter(reporter, "phaseHeader", { phase, label: phaseLabel, role });

  let agentMessages = [{ role: "system", content: systemPrompt }];

  if (options.continuationMessage) {
    agentMessages.push({
      role: "system",
      content: `<continuation-context>\n${options.continuationMessage}\n</continuation-context>`,
    });
  }

  if (smartContext && String(smartContext).trim()) {
    agentMessages.push({
      role: "system",
      content: `<task-context>\n${smartContext}\n</task-context>`,
    });
  }

  agentMessages.push({
    role: "user",
    content: `<system-reminder>\nYour operational mode has changed from plan to code.\nYou are no longer in read-only mode.\nYou are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.\n</system-reminder>\n\n${userInput}`,
  });

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

        const requestedToolName = tc.function.name;
        const normalizedToolName = normalizeToolName(requestedToolName);
        const normalizedArgs = normalizeToolArgs(requestedToolName, args);

        const argsArray = Object.keys(args || {}).map(k => `${k}="${String(args[k]).substring(0, 30)}"`);
        emitReporter(reporter, "toolExecution", {
          toolName: requestedToolName,
          args: argsArray.join(', '),
          argsObject: args,
        });

        let toolResultStr = "";
        let skipReporterToolResult = false;

        try {
          if (requestedToolName === "question") {
            if (typeof reporter?.askUser !== "function") {
              toolResultStr = "Error: question requires a TUI reporter with askUser handler.";
              statsErrors++;
            } else {
              const answers = [];
              for (const question of normalizedArgs.questions || []) {
                const optionLabels = Array.isArray(question.options) ? question.options.map((option) => option.label) : [];
                const answer = await reporter.askUser({
                  title: question.header || "Question",
                  question: question.question,
                  options: optionLabels,
                });
                answers.push({ header: question.header || "Question", answer });
              }
              toolResultStr = JSON.stringify(answers, null, 2);
            }
          }
          else if (requestedToolName === "lsp") {
            if (typeof runtime.lsp === "function") {
              toolResultStr = await runtime.lsp(normalizedArgs);
            } else {
              toolResultStr = "Error: lsp tool not registered in runtime.";
              statsErrors++;
            }
          }
          else if (normalizedToolName === "write_file") {
            if (role === 'plan' && !normalizedArgs.path.replace(/\\/g, '/').match(/\.kilo\/plans\/.*\.md$/)) {
               toolResultStr = `Error: write_file permission denied. In Plan mode, you may ONLY write to the '.kilo/plans/' directory with a '.md' extension.`;
               statsErrors++;
            } else {
               runtime.patchFile(normalizedArgs.path, normalizedArgs.content, undefined, { reporter, silent: true });
               toolResultStr = `Successfully wrote ${normalizedArgs.path}`;
               statsFilesCreated++;
            }
          }
          else if (normalizedToolName === "edit_file") {
            if (role === 'plan') {
               toolResultStr = `Error: edit_file permission denied in Plan mode. You must only create new files in '.kilo/plans/' using write_file.`;
               statsErrors++;
            } else {
               if (requestedToolName === "edit" && normalizedArgs.replaceAll) {
                 const existingContent = runtime.readFile(normalizedArgs.path);
                 if (!normalizedArgs.search) {
                   toolResultStr = "Error: edit requires oldString when replaceAll is true.";
                   statsErrors++;
                 } else {
                   const updatedContent = existingContent.split(normalizedArgs.search).join(normalizedArgs.replace);
                   runtime.patchFile(normalizedArgs.path, updatedContent, undefined, { reporter, silent: true });
                   toolResultStr = `Successfully edited ${normalizedArgs.path}`;
                   statsFilesEdited++;
                 }
               } else {
                 runtime.patchFile(normalizedArgs.path, null, normalizedArgs.edits || args.edits, { reporter, silent: true });
                 toolResultStr = `Successfully edited ${normalizedArgs.path}`;
                 statsFilesEdited++;
               }
            }
          }
          else if (normalizedToolName === "run_command") {
            const output = await runtime.runCommand(normalizedArgs.command, normalizedArgs.cwd, { reporter, silent: true, timeout: normalizedArgs.timeout });
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
            else if (normalizedToolName === "list_files") {
             const listPath = normalizedArgs.path || ".";
             if (typeof runtime.listFiles === "function") {
               const results = await runtime.listFiles(listPath, normalizedArgs.depth, normalizedArgs.includeHidden);
               toolResultStr = results.length > 0 ? `Entries:\n${results.join('\n')}` : "No entries found.";
             } else {
               toolResultStr = "Error: list_files tool not registered in runtime.";
             }
           }
          else if (normalizedToolName === "search_files") {
            if (typeof runtime.searchFiles === 'function') {
              const results = await runtime.searchFiles(normalizedArgs.pattern, { path: normalizedArgs.path });
              toolResultStr = results.length > 0 ? `Found files:\n${results.join('\n')}` : "No matching files found.";
            } else {
              toolResultStr = "Error: search_files tool not registered in runtime.";
            }
          }
          else if (normalizedToolName === "search_content") {
            if (typeof runtime.searchContent === 'function') {
              const results = await runtime.searchContent(normalizedArgs.query, { path: normalizedArgs.path, include: normalizedArgs.include });
              toolResultStr = results.length > 0 ? `Found occurrences:\n${results.join('\n')}` : "No matches found.";
            } else {
              toolResultStr = "Error: search_content tool not registered in runtime.";
            }
          }
          else if (normalizedToolName === "read_file") {
            try {
               const content = runtime.readFile(normalizedArgs.path);
               const lines = String(content || "").split("\n");
               const offset = Math.max(1, Number(normalizedArgs.offset || 1));
               const limit = Number.isFinite(Number(normalizedArgs.limit)) ? Math.max(1, Number(normalizedArgs.limit)) : null;
               const sliced = limit ? lines.slice(offset - 1, offset - 1 + limit) : lines.slice(offset - 1);
               toolResultStr = sliced.join("\n");
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
          else if (normalizedToolName === "send_user_message") {
            const briefResult = executeSendUserMessage(normalizedArgs, projectRoot, reporter);
            toolResultStr = JSON.stringify(briefResult, null, 2);
            skipReporterToolResult = true;
          }
          else if (normalizedToolName === "structured_output") {
            toolResultStr = JSON.stringify(executeStructuredOutput(normalizedArgs), null, 2);
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
               { role: args.subagent_type || "coder", reporter, allowTodoTools: false }
            );
            
            toolResultStr = `<task_result task_id="${args.task_id || ''}">\n\nSub-Agent Completed.\nFinal Output:\n${subResult.finalMessage?.content || "No output"}\n\n</task_result>`;
            emitReporter(reporter, "log", { level: "success", message: `Delegation finished: ${args.description}` });
          }
          else if (tc.function.name === "delegate_task") {
            emitReporter(reporter, "log", { level: "info", message: "Delegating explorer task..." });
            const subResult = await runAgentPipeline(args.task, smartContext, runtime, { role: "explorer", reporter, allowTodoTools: false });
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
          else if (tc.function.name === "apply_patch") {
            if (role === 'plan') {
              toolResultStr = `Error: apply_patch permission denied in Plan mode.`;
              statsErrors++;
            } else {
              try {
                const patchText = args.patchText || '';
                const lines = patchText.split('\n');
                let currentFile = null;
                let currentContent = '';
                let inAddBlock = false;
                let filesChanged = 0;
                
                for (const line of lines) {
                  if (line.startsWith('*** Add File: ')) {
                    currentFile = line.substring('*** Add File: '.length).trim();
                    currentContent = '';
                    inAddBlock = true;
                  } else if (line.startsWith('*** Delete File: ')) {
                    const deletePath = line.substring('*** Delete File: '.length).trim();
                    const fullPath = join(PROJECT_ROOT, deletePath);
                    if (existsSync(fullPath)) {
                      const fs = await import('fs/promises');
                      await fs.unlink(fullPath);
                      filesChanged++;
                    }
                    currentFile = null;
                    inAddBlock = false;
                  } else if (line.startsWith('*** Update File: ')) {
                    currentFile = line.substring('*** Update File: '.length).trim();
                    currentContent = '';
                    inAddBlock = false;
                  } else if (line.startsWith('*** Begin Patch') || line.startsWith('*** End Patch') || line.startsWith('*** Move to:')) {
                    // Skip envelope headers
                  } else if (line.startsWith('+') && currentFile) {
                    currentContent += line.substring(1) + '\n';
                  } else if (line.startsWith('@@') && currentFile) {
                    // Context line in update block - load existing content if first context
                    if (!inAddBlock && currentContent === '') {
                      try {
                        const fullPath = join(PROJECT_ROOT, currentFile);
                        currentContent = readFileSync(fullPath, 'utf-8');
                      } catch (e) {
                        // File doesn't exist, start fresh
                      }
                    }
                  } else if (line.startsWith('-') && currentFile) {
                    // Remove line from content
                    const removeText = line.substring(1) + '\n';
                    if (currentContent.includes(removeText)) {
                      currentContent = currentContent.replace(removeText, '');
                    }
                  } else if (line.trim() === '' && currentFile && currentContent !== '') {
                    // End of file block - write the file
                    runtime.patchFile(currentFile, currentContent, undefined, { reporter, silent: true });
                    filesChanged++;
                    currentFile = null;
                    currentContent = '';
                  }
                }
                
                // Handle last file if no trailing blank line
                if (currentFile && currentContent !== '') {
                  runtime.patchFile(currentFile, currentContent, undefined, { reporter, silent: true });
                  filesChanged++;
                }
                
                toolResultStr = `Successfully applied patch to ${filesChanged} file(s)`;
                statsFilesEdited += filesChanged;
              } catch (err) {
                toolResultStr = `Error applying patch: ${err.message}`;
                statsErrors++;
              }
            }
          }
          else if (tc.function.name === "batch") {
            const toolCalls = args.tool_calls || [];
            const results = [];
            const maxBatch = 25;
            const limitedCalls = toolCalls.slice(0, maxBatch);
            
            for (const call of limitedCalls) {
              try {
                const innerResult = await executeToolCall(call.tool, call.parameters, batchRuntime, role, smartContext, reporter);
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
            if (!allowTodoTools) {
              toolResultStr = "Error: todo tools are only available to the main agent.";
              statsErrors++;
            } else {
              try {
                const todos = writeTodoList(projectRoot, args.todos);
                const counts = getTodoCounts(todos);
                toolResultStr = JSON.stringify(todos, null, 2);
                emitReporter(reporter, "log", {
                  level: "info",
                  message: `Todo list updated: ${counts.total} total, ${counts.pending + counts.in_progress} open`
                });
              } catch (err) {
                toolResultStr = `Error writing todos: ${err.message}`;
                statsErrors++;
              }
            }
          }
          else if (tc.function.name === "todoread") {
            if (!allowTodoTools) {
              toolResultStr = "Error: todo tools are only available to the main agent.";
              statsErrors++;
            } else {
              try {
                toolResultStr = JSON.stringify(readTodoList(projectRoot), null, 2);
              } catch (err) {
                toolResultStr = `Error reading todos: ${err.message}`;
                statsErrors++;
              }
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

        if (!skipReporterToolResult) {
          emitReporter(reporter, "toolResult", {
            toolName: requestedToolName,
            text: summarizeToolResult(normalizedToolName, toolResultStr, normalizedArgs),
            fullText: String(toolResultStr || ""),
            isCollapsible: shouldCollapseToolResult(toolResultStr),
            args: normalizedArgs,
          });
        }

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
