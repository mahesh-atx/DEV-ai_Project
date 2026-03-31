import runAgentPipeline from "./agentController.js";
import chalk from "chalk";

const ORCHESTRATOR_PROMPT = `You are the DevAI Lead Architect.
The user wants to accomplish a complex task. An Explorer agent has already mapped the codebase and provided a Context Report.
Your job is to read the report, and break the objective down into independent implementation sub-tasks that can be executed fully in parallel by isolated Coder Agents.
CRITICAL: The sub-tasks MUST be independent. They must not rely on modifying the same exact files at the same time to prevent race conditions. Assign explicit file boundaries.
Output your response as a RAW JSON array of objects. Do not use markdown backticks.
Format:
[
  { "name": "Build Frontend UI", "instructions": "Create the React UI components in the /src/components directory..." },
  { "name": "Build Backend API", "instructions": "Create the Express API routes in the /server directory..." }
]`;

export async function executeParallelAgents(userInput, smartContext, runtime, options = {}) {
  let totalTokens = 0;
  const startTime = Date.now();

  // === WAVE 1: EXPLORATION ===
  console.log(chalk.bold.blue("\n  [WAVE 1] 🗺️ Launching Explorer Agent..."));
  const explorerResult = await runAgentPipeline(
    `Explore the codebase to gather context for this request: ${userInput}\nOutput a detailed ContextReport of the relevant files and architecture.`,
    smartContext,
    runtime,
    { ...options, role: "explorer" }
  );
  totalTokens += (explorerResult.totalTokens || 0);
  const contextReport = explorerResult.finalMessage?.content || "No context found.";

  // === WAVE 2: ORCHESTRATION & PARALLEL CODERS ===
  console.log(chalk.bold.magenta("\n  [WAVE 2] 🧠 Orchestrating Coder delegation..."));
  const orchestratorMessages = [
    { role: "system", content: ORCHESTRATOR_PROMPT },
    { role: "user", content: `Original Request: ${userInput}\n\nExplorer's Context Report:\n${contextReport}` }
  ];

  let rawReply;
  try {
    const response = await runtime.callAI(orchestratorMessages); // No tools, just text
    rawReply = response.content;
  } catch (err) {
    console.log(chalk.red(`  ✗ Orchestrator failed to plan: ${err.message}`));
    return { finalMessage: null, totalTokens };
  }

  let subTasks = [];
  try {
    const jsonMatch = rawReply.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
       subTasks = runtime.parseJSON(jsonMatch[0]);
    } else {
       subTasks = runtime.parseJSON(rawReply);
    }
    if (!Array.isArray(subTasks) || subTasks.length === 0) throw new Error("No array parsed");
  } catch (e) {
    console.log(chalk.yellow(`  ⚠ Orchestrator failed to output JSON tasks. Falling back to single Coder.`));
    return await runAgentPipeline(userInput, smartContext + "\n\n" + contextReport, runtime, { ...options, role: "coder" });
  }

  console.log(chalk.bold.green(`\n  [WAVE 2] 🚀 Delegating ${subTasks.length} parallel tasks to Coders!\n`));
  subTasks.forEach((t, i) => {
     console.log(chalk.cyan(`    Coder ${i+1}: `) + chalk.white(t.name));
     console.log(chalk.dim(`      ↳ ${t.instructions.substring(0, 100)}...`));
  });

  const agentPromises = subTasks.map(async (task) => {
     const prefixedInput = `[ORCHESTRATOR DELEGATION: ${task.name}]\nYour specific independent task: ${task.instructions}\n\nOriginal user request: ${userInput}\n\nContext Report:\n${contextReport}`;
     const { finalMessage, totalTokens: agentTokens } = await runAgentPipeline(prefixedInput, smartContext, runtime, { ...options, role: "coder" });
     totalTokens += (agentTokens || 0);
     return { name: task.name, message: finalMessage };
  });

  const results = await Promise.all(agentPromises);

  // === WAVE 3: VERIFICATION ===
  console.log(chalk.bold.yellow("\n  [WAVE 3] 🔍 Launching Debugger for verification..."));
  const verifyResult = await runAgentPipeline(
    `The coders have finished implementing: ${userInput}\nReview the workspace, run any necessary build/test commands to verify it worked. If successful, finish the task.`,
    smartContext,
    runtime,
    { ...options, role: "debugger" }
  );
  totalTokens += (verifyResult.totalTokens || 0);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.dim(`\n  ─────────────────────────────────────────────`));
  console.log(chalk.bold.magenta(`  [ORCHESTRATOR] All Waves completed perfectly in ${duration}s!`));

  const summaryContent = results.map(r => `Task: ${r.name}\nCompleted: ${r.message?.content || "No final output"}`).join("\n\n");
  
  return { 
    finalMessage: { 
        role: "assistant", 
        content: `Orchestrator finished all waves (Explore, Code, Debug):\n\n${summaryContent}\n\nDebugger Conclusion:\n${verifyResult.finalMessage?.content || "No verification output."}` 
    }, 
    totalTokens 
  };
}

export default executeParallelAgents;
