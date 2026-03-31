/**
 * engine/sessionManager.js — Session memory management and context compaction
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";

export const MEMORY_FILE = ".devai_memory.json";

export async function trimMemory(messages, client, modelConfig) {
  if (messages.length > 20) {
    console.log(chalk.yellow("\n  [Memory Compaction] Context length exceeded 20 messages. Summarizing old history..."));
    
    const messagesToCompact = messages.slice(1, 16); 
    const remainingMessages = messages.slice(16);
    
    const compactorPrompt = `You are a memory compaction agent. Your job is to summarize the following conversation history into a dense, structured overview.
Use these exact headings:
## Goal
## Instructions
## Discoveries
## Accomplished
## Relevant files / directories

Focus on facts, completed tasks, and current context. Do not output anything else.`;

    const apiMessages = [
      { role: "system", content: compactorPrompt },
      { role: "user", content: "Conversation History to summarize:\n" + JSON.stringify(messagesToCompact, null, 2) }
    ];

    try {
      const response = await client.chat.completions.create({
        model: modelConfig.id,
        messages: apiMessages,
        temperature: 0.3,
        max_tokens: 4000,
        ...modelConfig.extraParams
      });
      
      let summaryText = "";
      if (response.choices && response.choices[0] && response.choices[0].message) {
         summaryText = response.choices[0].message.content;
      } else {
         throw new Error("No message content returned from LLM");
      }
      
      messages.splice(1, messages.length - 2,
        { role: "assistant", content: "[COMPACTED MEMORY SUMMARY]\n" + summaryText },
        ...remainingMessages
      );
      console.log(chalk.green("  [Memory Compaction] Success. Memory condensed to save tokens.\n"));
    } catch (err) {
      console.log(chalk.red(`  [Memory Compaction] Failed: ${err.message}. Falling back to standard trim.\n`));
      messages.splice(1, messages.length - 20);
    }
  }
}

export function loadProjectMemory(memoryPath) {
  try {
    if (fs.existsSync(memoryPath)) {
      const raw = fs.readFileSync(memoryPath, "utf8");
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        return loaded;
      }
    }
  } catch (e) {
    // corrupted memory file
  }
  return null;
}

export function saveProjectMemory(memoryPath, messages) {
  try {
    fs.writeFileSync(memoryPath, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.log("⚠️  Warning: Could not save memory:", e.message);
  }
}

export function clearProjectMemory(projectDir) {
  const memoryPath = path.join(projectDir, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    fs.unlinkSync(memoryPath);
  }
}
