#!/usr/bin/env node
/**
 * devai.js — DevAI CLI Orchestrator
 * Main entry point: model selection, mode routing, interactive loop.
 * Extracted modules: context.js, jsonParser.js, patchEngine.js, sessionManager.js, selfDebug.js
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";
import { selectPrompt } from "./prompts/index.js";
import runAgentPipeline from "./engine/agentController.js";
import executeParallelAgents from "./engine/orchestrator.js";
import { runPlannerAgent } from "./engine/plannerAgent.js";
import { runPolishAgent } from "./engine/polishAgent.js";
import { runCommands } from "./engine/commandExecutor.js";
import { detectProjectType, detectBuildCommand, buildSmartContext } from "./engine/context.js";
import { patchFile } from "./engine/patchEngine.js";
import { parseJSON, retryReplyAsStructuredJSON } from "./engine/jsonParser.js";
import { MEMORY_FILE, trimMemory, loadProjectMemory, saveProjectMemory } from "./engine/sessionManager.js";
import { selfDebugLoop } from "./engine/selfDebug.js";
import { listWorkspaceEntries, searchWorkspaceFiles, searchWorkspaceContent } from "./utils/fileTools.js";
import {
  gitCheckpoint as createGitCheckpoint,
  gitRestore as restoreGitCheckpoint,
  gitDiscard as discardGitCheckpoint,
} from "./utils/git.js";
import {
  showWelcomeBanner,
  showAsciiWelcomeScreen,
  selectModelInteractive,
  showModelDetails,
  selectExecutionMode,
  showModeDetails,
  getModeColor,
  showSection,
  createSpinner,
  createStreamingPanel,
  createLiveFileTracker,
  showSuccess,
  showError,
  showInfo,
  showWarning,
  showDivider,
  promptInput,
  showList,
  showBox,
  showTimeline,
  showPlanBox,
  logErrorToFile,
} from "./cli-ui.js";
import inquirer from "inquirer";
import { injectApiKeyToEnv } from "./utils/configManager.js";

dotenv.config();
injectApiKeyToEnv();

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes("force closed") || msg.includes("SIGINT") || err?.name === "ExitPromptError") {
    process.exit(0);
  }
  logErrorToFile(err, "Uncaught Exception");
  console.error(chalk.red("\nFatal unexpected error occurred. See devai-error.log for details."));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logErrorToFile(reason, "Unhandled Rejection");
});

/* ================= INPUT ================= */

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}

/* ================= MAIN EXECUTION ================= */

let customBuildCmd = null;

export async function main() {

  /* ================= MODEL SELECTION ================= */

  await showAsciiWelcomeScreen();
  showWelcomeBanner("🚀 Advanced DevAI", "Autonomous AI Software Engineer • Multi-Agent Pipeline");

  const availableModels = listModels().map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description,
    ...m,
  }));

  let selectedKey;
  try {
    selectedKey = await selectModelInteractive(availableModels);
  } catch (err) {
    showError("Failed to select model");
    process.exit(1);
  }

  let modelConfig, client;
  try {
    modelConfig = getModel(selectedKey);
    client = createClient(modelConfig.apiKey);
  } catch (e) {
    showError(`${e.message}`);
    showInfo("Make sure your .env file has the correct API keys");
    process.exit(1);
  }

  showModelDetails(modelConfig);

  /* ================= AGENT MODE SELECTION ================= */

  showSection("Execution Mode", "⚙️");

  let selectedMode;
  try {
    selectedMode = await selectExecutionMode();
  } catch (err) {
    showError(`Failed to select execution mode: ${err.message}`);
    console.error(err);
    process.exit(1);
  }

  let agentMode = selectedMode === "agent" || selectedMode === "polish" || selectedMode === "orchestrator" || selectedMode === "planner";
  let autoPolish = selectedMode === "polish";

  showModeDetails(selectedMode);
  const modeColor = getModeColor(selectedMode);

  /* ================= PROJECT FOLDER ================= */

  const projectName = await promptInput(
    chalk.cyan("Project folder name (or '.' for current)"),
    "."
  );
  let projectDir;

  if (projectName === "." || projectName === "") {
    projectDir = process.cwd();
    showSuccess(`Using current directory: ${projectDir}`);
  } else {
    projectDir = path.resolve(process.cwd(), projectName);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
      showSuccess(`Created project folder: ${projectDir}`);
    } else {
      showInfo(`Using existing folder: ${projectDir}`);
    }
  }

  /* ================= MEMORY ================= */

  const memoryPath = path.join(projectDir, MEMORY_FILE);
  let messages = loadProjectMemory(memoryPath);
  if (!messages) {
    messages = [];
    showWarning("Memory file was corrupted, starting fresh");
  } else {
    showInfo(`Loaded conversation memory (${messages.length} messages)`);
  }

  if (messages.length === 0) {
    let initialPrompt;
    if (selectedMode === "ask") {
      initialPrompt = fs.readFileSync(path.resolve("./prompts/ask-only.txt"), "utf8");
    } else {
      initialPrompt = selectPrompt("", detectProjectType(projectDir));
    }
    messages = [{ role: "system", content: initialPrompt }];
  }

  /* ================= MAIN LOOP ================= */

  showSection("Ready to Start", "✨");
  showList([
    { icon: "🤖", text: `Model: ${modelConfig.name}`, color: "cyan" },
    { icon: "⚡", text: `Mode: ${selectedMode === "ask" ? "Ask Only" : agentMode ? "Agent Pipeline" : "Standard"}`, color: "yellow" },
    { icon: "📁", text: `Project: ${detectProjectType(projectDir)}`, color: "green" },
    { icon: "💡", text: "Type your request or use: /build <cmd> | /polish | /git | exit", color: "blue" },
  ]);
  showDivider();

  while (true) {
    const input = await promptInput(chalk.cyan("You"), "", { color: modeColor });
    if (!input || input.toLowerCase() === "exit") {
      showInfo("Session ended. Goodbye!");
      break;
    }

    // Handle /build command
    if (input.startsWith("/build")) {
      const cmd = input.slice(6).trim();
      if (cmd) {
        customBuildCmd = cmd;
        showSuccess(`Build command set: ${customBuildCmd}`);
      }
      await selfDebugLoop(projectDir, messages, client, modelConfig, customBuildCmd);
      continue;
    }

    // Handle /git command (quick commit + push with confirmation)
    if (input.startsWith("/git")) {
      const msg = input.slice(4).trim() || "DevAI: Update project files";

      try {
        const status = execSync("git status --porcelain", { cwd: projectDir, encoding: "utf8" }).trim();
        if (!status) {
          console.log(chalk.yellow("  Nothing to commit — working tree is clean."));
          continue;
        }
        console.log(chalk.cyan("\n  Files to be staged:"));
        status.split("\n").forEach(line => console.log(chalk.gray(`    ${line}`)));
      } catch {
        console.log(chalk.red("  Failed to read git status."));
        continue;
      }

      const confirm = await ask(chalk.yellow(`\n  Commit "${msg}" and push? (y/n): `));
      if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
        console.log(chalk.gray("  Git commit skipped."));
        continue;
      }

      await runCommands([
        "git add .",
        `git commit -m "${msg}"`,
        "git push"
      ], projectDir, { source: "manual_git" });
      continue;
    }

    // Handle /plan command directly from any mode
    if (input.startsWith("/plan")) {
      selectedMode = "planner";
      agentMode = true;
      showSuccess("Switched to Planner Mode for this request.");
      const extractedPrompt = input.slice(5).trim();
      if (extractedPrompt) {
        messages.push({ role: "user", content: extractedPrompt });
      }
    }

    // Handle /polish command (works in both modes)
    if (input.startsWith("/polish")) {
      const polishContext = buildSmartContext(projectDir, "improve code quality UI UX", modelConfig, messages);
      const polishRuntime = {
        callAI: async (prompt) => {
          let reply = "";
          const panel = createStreamingPanel({ label: "Polish agent" });
          const polishMessages = [
            { role: "system", content: messages[0].content },
            { role: "user", content: prompt }
          ];
          try {
            const stream = await client.chat.completions.create({
              model: modelConfig.id,
              messages: polishMessages,
              temperature: modelConfig.temperature,
              top_p: modelConfig.topP,
              max_tokens: modelConfig.maxTokens,
              stream: true,
              ...modelConfig.extraParams
            });
            for await (const chunk of stream) {
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                panel.update({ reasoningDelta: delta.reasoning_content, chars: reply.length });
              }
              if (delta?.content) {
                reply += delta.content;
                panel.update({ chars: reply.length });
              }
            }
          } finally {
            panel.stop({ percent: 100 });
          }
          process.stdout.write(`  ✓ Polish response received (${reply.length} chars)\n`);
          return reply;
        },
        parseJSON
      };
      
      const checkpoint = createGitCheckpoint(projectDir);
      const polishResult = await runPolishAgent(polishContext, polishRuntime);
      
      if (polishResult && polishResult.files) {
        console.log(`\n📂 Applying ${polishResult.files.length} polish edit(s):`);
        for (const f of polishResult.files) {
          if (!f.path) continue;
          if (f.edits && Array.isArray(f.edits)) {
            patchFile(projectDir, f.path, null, f.edits);
          } else if (typeof f.content === "string") {
            patchFile(projectDir, f.path, f.content);
          }
        }

        if (checkpoint) {
          const userAction = await ask(chalk.yellow("\n👀 Review polish changes. Keep them? (y/undo): "));
          if (userAction.toLowerCase() === "undo" || userAction.toLowerCase() === "n") {
            restoreGitCheckpoint(checkpoint);
            console.log(chalk.gray("   (Polish changes reverted)"));
          } else {
            discardGitCheckpoint(checkpoint);
            console.log(chalk.green("   ✓ Polish changes accepted."));
          }
        }
      } else {
        if (checkpoint) discardGitCheckpoint(checkpoint);
        console.log("ℹ️  No improvements suggested.");
      }
      continue;
    }

    // ==================== ASK ONLY MODE ====================
    // Runs before image prompt / smartContext / selectPrompt to skip all that
    if (selectedMode === "ask") {
      const chatMessages = [...messages, { role: "user", content: input }];

      let reply = "";
      let panel;
      try {
        const stream = await client.chat.completions.create({
          model: modelConfig.id,
          messages: chatMessages,
          temperature: modelConfig.temperature,
          top_p: modelConfig.topP,
          max_tokens: modelConfig.maxTokens,
          stream: true,
          ...modelConfig.extraParams
        });

        panel = createStreamingPanel({ label: "DevAI" });
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            panel.update({ reasoningDelta: delta.reasoning_content, chars: reply.length });
          }
          if (delta?.content) {
            reply += delta.content;
            panel.update({ chars: reply.length });
          }
        }
        panel.stop({ percent: 100 });
      } catch (e) {
        if (panel) panel.stop({ percent: 100 });
        showError(`API error: ${e.message}`);
        continue;
      }

      if (!reply.trim()) {
        showWarning("No response received. Try again.");
        continue;
      }

      // Update memory with plain text
      messages.push({ role: "user", content: input });
      messages.push({ role: "assistant", content: reply });
      await trimMemory(messages, client, modelConfig);
      saveProjectMemory(memoryPath, messages);

      showBox(`${chalk.cyan("DevAI")}\n\n${reply.trim()}`);
      showDivider();
      continue;
    }

    const imgPath = await ask("Image (optional / none): ");
    let imgBase64 = null;

    if (imgPath && imgPath.toLowerCase() !== "none") {
      try {
        if (!fs.existsSync(imgPath)) {
          console.log("⚠️  Image not found:", imgPath);
        } else {
          const sharp = (await import("sharp")).default;
          const buf = await sharp(imgPath).resize(1024).jpeg({ quality: 80 }).toBuffer();
          imgBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
          console.log("✓ Image loaded");
        }
      } catch (e) {
        console.log("⚠️  Could not load image:", e.message);
      }
    }

    const smartContext = buildSmartContext(projectDir, input, modelConfig, messages);

    // Dynamic prompt selection based on current user request
    const selectedPrompt = selectPrompt(input, detectProjectType(projectDir));
    messages[0].content = selectedPrompt;

    // ==================== AGENT MODE PIPELINE ====================
    if (agentMode) {
      const runtime = {
        callAI: async (agentMessages, tools = undefined) => {
          let replyContent = "";
          let toolCalls = [];
          
          if (imgBase64) {
            const lastMsg = agentMessages[agentMessages.length - 1];
            if (lastMsg.role === "user" && typeof lastMsg.content === "string") {
              lastMsg.content = [
                { type: "text", text: lastMsg.content },
                { type: "image_url", image_url: { url: imgBase64 } }
              ];
            }
          }
          
          const panel = createStreamingPanel({ label: tools ? "Agent acting" : "Agent response" });
          const stream = await client.chat.completions.create({
            model: modelConfig.id,
            messages: agentMessages,
            temperature: modelConfig.temperature,
            top_p: modelConfig.topP,
            max_tokens: modelConfig.maxTokens,
            stream: true,
            tools: tools,
            ...modelConfig.extraParams
          });
          
          let thinkBuffer = "";
          let inThinkMode = false;

          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            
            if (delta.reasoning_content) {
              panel.update({ reasoningDelta: delta.reasoning_content, chars: replyContent.length });
            }
            if (delta.content) {
              replyContent += delta.content;
              
              // Handle models that emit <think> tags in delta.content instead of reasoning_content
              thinkBuffer += delta.content;
              while (thinkBuffer.length > 0) {
                 if (!inThinkMode) {
                    const startIdx = thinkBuffer.indexOf("<think>");
                    if (startIdx !== -1) {
                       inThinkMode = true;
                       thinkBuffer = thinkBuffer.substring(startIdx + 7); // skip <think>
                    } else {
                       // limit buffer size to prevent memory leak, but keep enough for a split tag
                       if (thinkBuffer.length > 7) thinkBuffer = thinkBuffer.slice(-7);
                       break;
                    }
                 } else {
                    const endIdx = thinkBuffer.indexOf("</think>");
                    if (endIdx !== -1) {
                       const reasoningChunk = thinkBuffer.substring(0, endIdx);
                       if (reasoningChunk) panel.update({ reasoningDelta: reasoningChunk, chars: replyContent.length });
                       inThinkMode = false;
                       thinkBuffer = thinkBuffer.substring(endIdx + 8); // skip </think>
                    } else {
                       // We are in think mode, flush the entire buffer as reasoningDelta
                       if (thinkBuffer.length > 0) {
                          // wait, check if partial </think> is at the end
                          const partialIdx = thinkBuffer.lastIndexOf("<");
                          if (partialIdx !== -1 && "</think>".startsWith(thinkBuffer.substring(partialIdx))) {
                             const reasoningChunk = thinkBuffer.substring(0, partialIdx);
                             if (reasoningChunk) panel.update({ reasoningDelta: reasoningChunk, chars: replyContent.length });
                             thinkBuffer = thinkBuffer.substring(partialIdx); // keep partial tag
                             break;
                          } else {
                             panel.update({ reasoningDelta: thinkBuffer, chars: replyContent.length });
                             thinkBuffer = "";
                          }
                       }
                       break;
                    }
                 }
              }

              panel.update({ chars: replyContent.length });
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (toolCalls[idx] === undefined) {
                  toolCalls[idx] = { 
                    id: tc.id || "", 
                    type: "function", 
                    function: { name: tc.function?.name || "", arguments: "" } 
                  };
                } else {
                   if (tc.id) toolCalls[idx].id = tc.id;
                   if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCalls[idx].function.arguments += tc.function.arguments;
                  panel.update({ chars: toolCalls[idx].function.arguments.length });
                }
              }
            }
          }
          panel.stop({ percent: 100 });
          process.stdout.write(`\r  ✓ AI turn complete\n`);
          return { 
            role: "assistant", 
            content: replyContent || null, 
            tool_calls: toolCalls.length > 0 ? toolCalls.filter(Boolean) : undefined 
          };
        },
        parseJSON,
        modelConfig,
        readFile: (filePath) => {
          const cleanPath = filePath.replace(/^(\/|\\)+/, "");
          const finalPath = path.resolve(projectDir, cleanPath);
          if (!finalPath.startsWith(path.resolve(projectDir))) {
            throw new Error(`Security Exception: Path traversal denied for ${filePath}`);
          }
          return fs.readFileSync(finalPath, "utf8");
        },
        patchFile: (filePath, content, edits, patchOptions = {}) => patchFile(projectDir, filePath, content, edits, patchOptions),
        runCommand: async (cmd, cwd, commandOptions = {}) => {
          const workingDir = cwd ? path.resolve(projectDir, cwd) : projectDir;
          const relativeToProject = path.relative(path.resolve(projectDir), workingDir);
          if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) {
            throw new Error(`Security Exception: Working directory traversal denied for ${cwd}`);
          }
          return await runCommands([cmd], workingDir, { source: "tool_agent", ...commandOptions });
        },
        listFiles: async (subpath = ".", depth = 2, includeHidden = false) =>
          listWorkspaceEntries(projectDir, subpath, { depth, includeHidden }),
        searchFiles: async (pattern) => searchWorkspaceFiles(projectDir, pattern),
        searchContent: async (query) => searchWorkspaceContent(projectDir, query),
        buildFreshContext: (query) => buildSmartContext(projectDir, query, modelConfig, messages),
      };
      
      // Create checkpoint before agent pipeline
      const checkpoint = createGitCheckpoint(projectDir);
      
      let finalMessage, totalTokens;
      if (selectedMode === "planner") {
         const planDir = path.join(projectDir, ".kilo", "plans");
         if (!fs.existsSync(planDir)) {
             fs.mkdirSync(planDir, { recursive: true });
         }
         const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
         const planFile = path.join(planDir, `${timestamp}-plan.md`);
         
         const planInput = input.startsWith("/plan") ? input.slice(5).trim() || "Write a plan." : input;
         
         // INJECT SYNTHETIC REMINDER
         const syntheticReminder = `\n\n<system-reminder>\nYou are currently strictly operating in Plan Mode.\nYou MUST write your final formal plan EXCLUSIVELY to this absolute file path: ${planFile}\nDo NOT attempt to write or edit any other files. Do this using the write_file tool.\nCall 'plan_exit' when you are completely finished with your research and plan writing.\n</system-reminder>\n`;
         
         const planPrompt = planInput + syntheticReminder;
         
         console.log(chalk.magenta(`\n  [PLAN MODE] Assigned plan workspace: ${planFile}`));
         const execResult = await runAgentPipeline(planPrompt, smartContext, runtime, { autoPolish: false, role: "plan" });
         
         finalMessage = execResult.finalMessage;
         
         // Update memory for the initial plan generation immediately
         if (execResult.finalMessage) {
             messages.push({ role: "user", content: input });
             messages.push(execResult.finalMessage);
             await trimMemory(messages, client, modelConfig);
             saveProjectMemory(memoryPath, messages);
         }

         // HANDOFF LOOP
         let planHandoffComplete = false;
         while (!planHandoffComplete) {
            if (fs.existsSync(planFile)) {
                showBox(`${chalk.cyan("Plan Generated:")}\n\n${fs.readFileSync(planFile, "utf8").trim()}`);
            }

            console.log(chalk.bold.yellow("\n  >>> PLAN HANDOFF <<<"));
            const { action } = await inquirer.prompt([{
               type: "rawlist",
               name: "action",
               message: "Select next phase:",
               choices: [
                  { name: "Switch to agent mode and implement now", value: "execute" },
                  { name: "Refine the plan", value: "refine" },
                  { name: "Type your answer", value: "custom" }
               ]
            }]);
            
            if (action === "execute") {
               selectedMode = "agent";
               console.log(chalk.green(`\nExecuting plan... Switched to Execution Agent mode.`));
               const promptInject = `Implement the plan that was just generated at ${planFile}. Use your tools to read the plan and then execute the design described within it.`;
               const executeResult = await runAgentPipeline(promptInject, smartContext, runtime, { autoPolish: false, role: "coder" });
               
               if (executeResult.finalMessage) {
                  messages.push({ role: "user", content: promptInject });
                  messages.push(executeResult.finalMessage);
                  await trimMemory(messages, client, modelConfig);
                  saveProjectMemory(memoryPath, messages);
               }
               planHandoffComplete = true;

            } else if (action === "refine") {
               console.log(chalk.green(`\nRefining the plan...`));
               const refinePrompt = "Please review the generated plan, identify any gaps, missing implementation details, or architectural flaws, and refine it. Update the plan file.";
               const refineResult = await runAgentPipeline(refinePrompt, smartContext, runtime, { autoPolish: false, role: "plan" });
               
               if (refineResult.finalMessage) {
                  messages.push({ role: "user", content: refinePrompt });
                  messages.push(refineResult.finalMessage);
                  await trimMemory(messages, client, modelConfig);
                  saveProjectMemory(memoryPath, messages);
               }
            } else if (action === "custom") {
               const customAns = await promptInput(chalk.cyan("Your answer: "), "", { color: modeColor });
               const customResult = await runAgentPipeline(customAns, smartContext, runtime, { autoPolish: false, role: "plan" });
               
               if (customResult.finalMessage) {
                  messages.push({ role: "user", content: customAns });
                  messages.push(customResult.finalMessage);
                  await trimMemory(messages, client, modelConfig);
                  saveProjectMemory(memoryPath, messages);
               }
            }
         }
         
         showSuccess("Tool pipeline execution completed", "✅");
         showDivider();
         continue;
      } else if (selectedMode === "orchestrator") {
        console.log(chalk.bold.magenta("\n  [ORCHESTRATOR MODE] Initializing Orchestrator Agent..."));
        const result = await runAgentPipeline(input, smartContext, runtime, { autoPolish, role: "orchestrator" });
        finalMessage = result.finalMessage;
        totalTokens = result.totalTokens;
      } else {
        const result = await runAgentPipeline(input, smartContext, runtime, { autoPolish, role: "general" });
        finalMessage = result.finalMessage;
        totalTokens = result.totalTokens;
      }
      
      if (!finalMessage) {
        console.log("\n⚠️  Agent pipeline produced no result. Try again.\n");
        continue;
      }
      
      // Update memory
      messages.push({ role: "user", content: input });
      messages.push(finalMessage);
      await trimMemory(messages, client, modelConfig);
      saveProjectMemory(memoryPath, messages);
      
      showSuccess("Tool pipeline execution completed", "✅");
      showDivider();
      continue;
    }

    // ==================== STANDARD MODE (Original Flow) ====================
    
    const fullUserText = `User request: ${input}\nProject: ${detectProjectType(projectDir)}\nProject folder: ${projectDir}\n\n${smartContext}`;
    
    const apiContent = imgBase64
      ? [
          { type: "text", text: fullUserText },
          { type: "image_url", image_url: { url: imgBase64 } }
        ]
      : fullUserText;

    const historyContent = imgBase64
      ? [
          { type: "text", text: input },
          { type: "image_url", image_url: { url: imgBase64 } }
        ]
      : input;

    const apiMessages = [...messages, { role: "user", content: apiContent }];

    let spinnerInt;
    const spinnerChars = ["|", "/", "-", "\\"];
    let spIndex = 0;
    
    process.stdout.write("DevAI: Planning & coding  ");
    spinnerInt = setInterval(() => {
      process.stdout.write(`\rDevAI: Planning & coding ${spinnerChars[spIndex++ % 4]} `);
    }, 100);

    let reply = "";

    for (let i = 0; i < 3; i++) {
      let panel;
      try {
        const stream = await client.chat.completions.create({
          model: modelConfig.id,
          messages: apiMessages,
          temperature: modelConfig.temperature,
          top_p: modelConfig.topP,
          max_tokens: modelConfig.maxTokens,
          stream: true,
          ...modelConfig.extraParams
        });

        let chunks = "";
        let chunkCount = 0;
        const tracker = createLiveFileTracker();
        panel = createStreamingPanel({ label: "Generating response" });

        for await (const chunk of stream) {
          if (spinnerInt) {
              clearInterval(spinnerInt);
              spinnerInt = null;
              process.stdout.write("\n");
          }

          chunkCount++;
          const delta = chunk.choices?.[0]?.delta;
          
          if (delta?.reasoning_content) {
            panel.update({ reasoningDelta: delta.reasoning_content, chars: chunks.length });
          }
          if (delta?.content) {
            chunks += delta.content;
            tracker.feed(delta.content);
            panel.update({ chars: chunks.length, files: tracker.getFiles() });
          }
        }
        panel.stop({ percent: 100 });
        reply = chunks;

        if (reply.trim()) {
          console.log(` ✓ Received full response.`);
          break;
        }
        console.log(`\n⚠️  Empty response (got ${chunkCount} chunks), retrying (${i + 1}/3)...`);
      } catch (e) {
        if (panel) panel.stop({ percent: 100 });
        if (spinnerInt) { clearInterval(spinnerInt); spinnerInt = null; process.stdout.write("\n"); }
        console.log(`\n❌ Error: ${e.message}`);
        if (i === 2) console.log("Aborting after 3 attempts.");
        if (e.status === 401) {
          console.log("   API key is invalid. Check your .env file.");
          break;
        }
        if (e.status === 429) {
          console.log("   Rate limited. Waiting 5 seconds...");
          await new Promise(r => setTimeout(r, 5000));
        }
        if (i < 2) console.log("   Retrying...");
      }
    }

    if (!reply.trim()) {
      console.log("\n⚠️  No response received. Try again or switch model.\n");
      continue;
    }

    // Update memory
    messages.push({ role: "user", content: historyContent });
    messages.push({ role: "assistant", content: reply });
    await trimMemory(messages, client, modelConfig);
    saveProjectMemory(memoryPath, messages);

    // Auto-detect and strip leading explanation text
    if (!reply.trim().startsWith("{")) {
      const jsonStart = reply.indexOf("{");
      if (jsonStart !== -1) reply = reply.slice(jsonStart);
    }

    const parsed = parseJSON(reply);

    if (!parsed) {
      console.log("\n⚠️  Could not parse AI response as JSON.");
      console.log("   Retrying once with a strict JSON-only repair prompt...");

      const repairedReply = await retryReplyAsStructuredJSON(client, modelConfig, apiMessages, reply);
      const repairedParsed = parseJSON(repairedReply);

      if (repairedParsed) {
        reply = repairedReply;
      } else {
        console.log("   The AI replied with text instead of structured output.");
      
        const rawFile = path.join(projectDir, "_devai_last_response.txt");
        fs.writeFileSync(rawFile, reply);
        console.log(`   Raw response saved to: ${rawFile}`);
        console.log("   Tip: Try asking again with a simpler request.\n");
        continue;
      }
    }

    const parsedResult = parseJSON(reply);

    if (parsedResult.plan) {
      console.log("\n🧠 Plan:");
      parsedResult.plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    }

    if (parsedResult.files && Array.isArray(parsedResult.files)) {
      
      // Create Checkpoint
      const checkpoint = createGitCheckpoint(projectDir);

      console.log(`\n📂 Writing ${parsedResult.files.length} file(s):`);
      for (const f of parsedResult.files) {
        if (!f.path) {
          console.log("  ❌ Skipped invalid file entry (missing path)");
          continue;
        }
        if (f.edits && Array.isArray(f.edits)) {
          patchFile(projectDir, f.path, null, f.edits);
        } else if (typeof f.content === "string") {
          patchFile(projectDir, f.path, f.content);
        } else {
          console.log("  ❌ Skipped invalid file entry (missing content or edits)");
        }
      }

      // Verification Prompt
      if (checkpoint) {
        const userAction = await ask(chalk.yellow("\n👀 Review changes. Keep them? (y/undo): "));
        
        if (userAction.toLowerCase() === "undo" || userAction.toLowerCase() === "n") {
          restoreGitCheckpoint(checkpoint);
          messages.pop(); 
          messages.pop(); 
          console.log(chalk.gray("   (Memory rewound)"));
        } else {
          discardGitCheckpoint(checkpoint);
          console.log(chalk.green("   ✓ Changes accepted."));
        }
      }
    }

    // Auto-execute commands from AI
    if (parsedResult.commands) {
      await runCommands(parsedResult.commands, projectDir, { source: "standard_mode" });
    }

    if (parsedResult.instructions) {
      showSection("Manual Steps", "📌");
      showList(
        parsedResult.instructions.map((s, i) => ({
          icon: `${i + 1}.`,
          text: s,
          color: "yellow",
        }))
      );
    }

    showSuccess("Standard mode execution completed", "✅");
    showDivider();
  }

  showInfo("Thank you for using DevAI!");
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch(err => {
    showError(`Fatal error: ${err.message}`);
    logErrorToFile(err, "Main Loop Crash");
    console.error(err);
    process.exit(1);
  });
}
