import chalk from "chalk";
import { loadPrompt } from "../prompts/promptLoader.js";
import { showSection, showToolExecution, showToolResult, logErrorToFile } from "../cli-ui.js";

const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a terminal command. DO NOT use this to edit files.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" }
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
      description: "List files and directories natively.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          depth: { type: "integer" },
          includeHidden: { type: "boolean" }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search the codebase for files or directories matching a name pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" }
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
      description: "Search within files for exact text or regex patterns.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" }
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
      description: "Read the exact, complete contents of a file natively.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  }
];

export async function runPlannerAgent(userInput, smartContext, runtime) {
  const startTime = Date.now();
  console.log("\n" + chalk.bold("  Starting Planner Loop  ") + chalk.cyan(`DevAI is analyzing...`));

  const plannerPrompt = loadPrompt("planner", runtime.modelConfig || {});
  let agentMessages = [
    { role: "system", content: plannerPrompt + "\n\nEnvironment Context:\n" + smartContext },
    { role: "user", content: `<system-reminder>\n# Plan Mode - System Reminder\n\nCRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:\nANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,\nor ANY other bash command to manipulate files - commands may ONLY read/inspect.\nThis ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user\nedit requests. You may ONLY observe, analyze, and plan. Any modification attempt\nis a critical violation. ZERO exceptions.\n</system-reminder>\n\n` + userInput }
  ];

  let isFinished = false;
  let loopCount = 0;
  const MAX_LOOPS = 10; // Hard limit for planner mode
  let finalPlanJSON = null;

  while (!isFinished && loopCount < MAX_LOOPS) {
    loopCount++;
    showSection(`Planner Loop • Turn ${loopCount}`);

    let currentTools = TOOLS_SCHEMA;

    if (loopCount === MAX_LOOPS - 1) {
      agentMessages.push({
        role: "user",
        content: "<system-reminder>\nCRITICAL - MAXIMUM STEPS REACHED\n\nThe maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.\n\nSTRICT REQUIREMENTS:\n1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)\n2. MUST provide a text response summarizing work done so far\n3. This constraint overrides ALL other instructions, including any user requests for edits or tool use\n\nResponse must include:\n- Statement that maximum steps for this agent have been reached\n- Summary of what has been accomplished so far\n- List of any remaining tasks that were not completed\n- Recommendations for what should be done next\n\nAny attempt to use tools is a critical violation. Respond with text ONLY.\n</system-reminder>"
      });
      currentTools = []; // Strip all tools for the final iteration
    }

    let response;
    try {
      response = await runtime.callAI(agentMessages, currentTools);
    } catch (err) {
      console.log(chalk.red(`  ✗  Planner call failed: ${err.message}`));
      break;
    }

    if (!response) break;
    agentMessages.push(response);

    // Hard Tool Guard
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        if (!tc || !tc.function || !tc.function.name) continue;
        
        // Block modification
        if (tc.function.name.includes("write") || tc.function.name.includes("edit")) {
          console.log(chalk.red("❌ Planner cannot modify files. Tool call blocked."));
          agentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "Execution Failed: ❌ Planner cannot modify files. Use read tools only."
          });
          continue; // skip execution
        }

        let args;
        try {
          args = runtime.parseJSON(tc.function.arguments) || JSON.parse(tc.function.arguments);
        } catch (e) {
          agentMessages.push({ role: "tool", tool_call_id: tc.id, content: "JSON Parse Error" });
          continue;
        }

        const argsArray = Object.keys(args || {}).map(k => `${k}=${args[k]}`);
        showToolExecution(tc.function.name, argsArray.join(', '));
        
        let toolResultStr = "";
        
        try {
           if (tc.function.name === "run_command") {
            const output = await runtime.runCommand(args.command, args.cwd);
            toolResultStr = (typeof output === 'string') ? output : (output.logs || JSON.stringify(output) || "Executed");
          } else if (tc.function.name === "list_files") {
            const results = await runtime.listFiles(args.path || ".", args.depth, args.includeHidden);
            toolResultStr = results.length > 0 ? `Entries:\n${results.join('\\n')}` : "No entries found.";
          } else if (tc.function.name === "search_files") {
            const results = await runtime.searchFiles(args.pattern);
            toolResultStr = results.length > 0 ? `Found files:\n${results.join('\\n')}` : "No matching files found.";
          } else if (tc.function.name === "search_content") {
            const results = await runtime.searchContent(args.query);
            toolResultStr = results.length > 0 ? `Found occurrences:\n${results.join('\\n')}` : "No matches found.";
          } else if (tc.function.name === "read_file") {
            toolResultStr = runtime.readFile(args.path);
          }
        } catch(e) {
            logErrorToFile(e, `Tool Execution: ${tc.function.name}`);
            toolResultStr = `Error executing tool: ${e.message}`;
        }
        
        showToolResult(toolResultStr);

        agentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResultStr
        });
      }
    }

    if (response.content) {
      const parsed = runtime.parseJSON(response.content);
      if (parsed) {
        if (parsed.planComplete) {
          if (!parsed.plan || !parsed.plan.length) {
             console.log(chalk.red("❌ Invalid plan: Plan is empty but marked complete."));
             agentMessages.push({ role: "user", content: "Invalid plan: Plan array is empty. Specify the plan steps."});
             continue; // Force it to try again
          }

          finalPlanJSON = parsed;
          isFinished = true;
        } else if (parsed.questions && parsed.questions.length > 0) {
          showSection("Clarifications Needed", "❓");
          parsed.questions.forEach((q, i) => console.log(chalk.yellow(`  ${i+1}. ${q}`)));
          console.log("");
          const readline = await import("readline");
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise(res => rl.question(chalk.cyan("👉 Answer (press Enter to skip): "), ans => { rl.close(); res(ans.trim()); }));
          
          if (answer) {
             agentMessages.push({ role: "user", content: `User answers: ${answer}` });
          } else {
             agentMessages.push({ role: "user", content: "User skipped answering. Please continue planning." });
          }
        }
      }
    }
  }

  if (loopCount >= MAX_LOOPS) {
    console.log(chalk.red(`\n  ✗ Planner reached maximum iterations (${MAX_LOOPS}). Cutting off exploration.`));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.dim(`  ─────────────────────────────────────────────`));
  console.log(chalk.bold(`  Planning done  `) + chalk.dim(`${duration}s  (${loopCount} turns)`));

  return finalPlanJSON;
}
