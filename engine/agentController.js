/**
 * Agent Controller — Interactive Tool Calling Pipeline
 * DevAI operates in a dynamic loop, acting and validating via tools.
 */

import { runPolishAgent } from "./polishAgent.js";
import { showSection, showToolExecution, showToolResult, logErrorToFile, createPhaseSpinner, showPhaseHeader, showSummaryCard } from "../cli-ui.js";
import { loadPrompt } from "../prompts/promptLoader.js";
import chalk from "chalk";
import os from "os";
import fs from "fs";
import path from "path";

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
  plan: `You are a Lead AI Systems Architect meticulously operating in Plan Mode.\nYour objective is exclusively to explore the codebase and write a comprehensive plan markdown file.\nYou operate in a strict read-only execution environment. You MUST NOT edit source code files or run terminal shell commands.\n\nYour 5-Phase Planning Workflow:\n1. Initial Understanding: Explore the codebase natively.\n2. Design: Formulate a solution.\n3. Review: Verify architectural feasibility.\n4. Final Plan: Write the plan EXCLUSIVELY to your designated plan file (in .kilo/plans/).\n5. Completion: Call the 'plan_exit' tool to signal the user.\n${BASE_RULES}`
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
      description: "Pause execution and explicitly ask the user a clarifying question before proceeding.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The specific question to ask the user." }
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
  }
];

function getToolsForRole(role) {
  const universal = ["ask_user", "delegate_task"];
  if (role === 'explorer') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "finish_task", ...universal].includes(t.function.name));
  if (role === 'coder') return TOOLS_SCHEMA.filter(t => ["write_file", "edit_file", "read_file", "finish_task", ...universal].includes(t.function.name));
  if (role === 'debugger') return TOOLS_SCHEMA.filter(t => ["run_command", "read_file", "finish_task", ...universal].includes(t.function.name));
  if (role === 'plan') return TOOLS_SCHEMA.filter(t => ["list_files", "search_files", "search_content", "read_file", "write_file", "plan_exit", ...universal].includes(t.function.name));
  return TOOLS_SCHEMA;
}

/**
 * Interactive Open-Ended Tool execution loop
 */
export async function runAgentPipeline(userInput, smartContext, runtime, options = {}) {
  const role = options.role || "general";
  const systemPrompt = loadPrompt(role, runtime.modelConfig || {});
  const activeTools = getToolsForRole(role);

  const startTime = Date.now();
  const phase = role === 'general' ? 'building' : role === 'explorer' ? 'exploring' : role === 'debugger' ? 'debugging' : 'coding';
  showPhaseHeader(phase, `Agent Loop [${role.toUpperCase()}]`);

  let agentMessages = [
    { role: "system", content: systemPrompt + "\n\nEnvironment Context:\n" + smartContext },
    { role: "user", content: `<system-reminder>\nYour operational mode has changed from plan to code.\nYou are no longer in read-only mode.\nYou are permitted to make file changes, run shell commands, and utilize your arsenal of tools as needed.\n</system-reminder>\n\n` + userInput }
  ];

  let isFinished = false;
  let finalMessage = null;
  let loopCount = 0;
  const MAX_LOOPS = 25;
  let totalTokens = 0;

  // Execution stats for summary card
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

    // STEP 1: Animated spinner while AI thinks
    const spinner = createPhaseSpinner(phase, `Turn ${loopCount} — Thinking...`);

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
      console.log(chalk.yellow("  ⚠  Empty response."));
      break;
    }

    agentMessages.push(response);

    if (response.content && !response.tool_calls) {
      console.log(chalk.gray(`  ${response.content.slice(0, 150)}${response.content.length > 150 ? '…' : ''}`));
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        if (!tc || !tc.function || !tc.function.name) continue;

        let args;
        try {
          args = runtime.parseJSON(tc.function.arguments) || JSON.parse(tc.function.arguments);
        } catch (e) {
          console.log(chalk.red(`  Error parsing arguments for ${tc.function.name}`));
          agentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Execution Failed: Could not parse arguments JSON.`
          });
          continue;
        }

        const argsArray = Object.keys(args || {}).map(k => `${k}="${String(args[k]).substring(0, 30)}"`);
        showToolExecution(tc.function.name, argsArray.join(', '));

        let toolResultStr = "";

        try {
          if (tc.function.name === "write_file") {
            if (role === 'plan' && !args.path.replace(/\\/g, '/').match(/\.kilo\/plans\/.*\.md$/)) {
               toolResultStr = `Error: write_file permission denied. In Plan mode, you may ONLY write to the '.kilo/plans/' directory with a '.md' extension.`;
               statsErrors++;
            } else {
               runtime.patchFile(args.path, args.content);
               toolResultStr = `Successfully wrote ${args.path}`;
               statsFilesCreated++;
            }
          }
          else if (tc.function.name === "edit_file") {
            if (role === 'plan') {
               toolResultStr = `Error: edit_file permission denied in Plan mode. You must only create new files in '.kilo/plans/' using write_file.`;
               statsErrors++;
            } else {
               runtime.patchFile(args.path, null, args.edits);
               toolResultStr = `Successfully edited ${args.path}`;
               statsFilesEdited++;
            }
          }
          else if (tc.function.name === "run_command") {
            const output = await runtime.runCommand(args.command, args.cwd);
            statsCommandsRun++;

            if (output && typeof output.logs === 'string') {
               toolResultStr = output.logs || "Command executed with no output.";
            } else if (typeof output === 'string') {
               toolResultStr = output;
            } else {
               toolResultStr = JSON.stringify(output) || "Command executed.";
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
            console.log(chalk.green(`\n  ✔ Task complete: ${args.message}`));
          }
          else if (tc.function.name === "plan_exit") {
            finalMessage = Object.assign({}, response, {
               content: response.content ? `${response.content}\n\nTask Finished: Plan completed.` : `Task Finished: Plan completed.`
            });
            isFinished = true;
            toolResultStr = "Plan finished successfully.";
            console.log(chalk.green(`\n  ✔ Plan phase complete.`));
          }
          else if (tc.function.name === "ask_user") {
            const inquirer = (await import("inquirer")).default;
            console.log(`\n🤖 ` + chalk.cyan.bold("Agent asks:") + ` ${args.question}`);
            const ans = await inquirer.prompt([{
               type: 'input',
               name: 'reply',
               message: chalk.yellow("Your reply:")
            }]);
            toolResultStr = ans.reply;
          }
          else if (tc.function.name === "delegate_task") {
            console.log(chalk.magenta(`\n  [DELEGATE] Spawning sub-agent (explorer)...`));
            const subResult = await runAgentPipeline(args.task, smartContext, runtime, { role: "explorer" });
            toolResultStr = `Sub-agent completed task.\n\nFinal Report:\n${subResult.finalMessage?.content || "No output"}`;
            console.log(chalk.magenta(`  [DELEGATE] Sub-agent finished.`));
          } else {
            toolResultStr = `Error: Unknown tool ${tc.function.name}`;
          }
        } catch (err) {
          console.log(chalk.red(`    Error running tool: ${err.message}`));
          toolResultStr = `Error executing tool: ${err.message}`;
          statsErrors++;
        }

        // STEP 2: Collapsed tool result
        showToolResult(toolResultStr);

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
    console.log(chalk.red(`\n  ✗ Max loop count reached (${MAX_LOOPS}).`));
  }

  // STEP 5.5: Auto-polish pass (if enabled)
  if (options.autoPolish && runtime.buildFreshContext) {
    console.log(chalk.bold.magenta("\n  [AUTO-POLISH] 🎨 Running polish pass..."));
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
      };
      const polishResult = await runPolishAgent(polishContext, polishRuntime);
      if (polishResult && polishResult.files) {
        console.log(chalk.green(`  ✔ Auto-polish: ${polishResult.files.length} file(s) improved`));
        for (const f of polishResult.files) {
          if (!f.path) continue;
          if (f.edits && Array.isArray(f.edits)) {
            runtime.patchFile(f.path, null, f.edits);
          } else if (typeof f.content === "string") {
            runtime.patchFile(f.path, f.content);
          }
        }
      } else {
        console.log(chalk.gray("  ℹ Auto-polish: No improvements needed."));
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Auto-polish failed: ${err.message}`));
      logErrorToFile(err, "Auto-Polish");
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // STEP 6: Summary card
  showSummaryCard({
    filesCreated: statsFilesCreated,
    filesEdited: statsFilesEdited,
    commandsRun: statsCommandsRun,
    errors: statsErrors,
    duration: `${duration}s`,
    loopCount,
  });

  return { finalMessage, totalTokens };
}

export default runAgentPipeline;
