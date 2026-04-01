import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadPrompt(role, modelConfig = {}, extraContext = {}) {
  const baseRulesPath = path.join(__dirname, 'base_rules.txt');
  const rolePath = path.join(__dirname, `${role}.txt`);
  
  let baseRules = "";
  let rolePrompt = "";
  
  try {
    baseRules = fs.readFileSync(baseRulesPath, 'utf8');
  } catch(e) {
      console.error("Missing base_rules.txt");
  }
  
  try {
    rolePrompt = fs.readFileSync(rolePath, 'utf8');
  } catch(e) {
    rolePrompt = `You are DevAI — an Elite Autonomous AI Software Engineer.\nYour ultimate goal is to complete the user's request using tools.`;
  }

  const osInfo = `Operating System: ${os.platform()} (${os.release()}).\nIf on Windows, use 'dir' instead of 'ls', and 'python' or 'py' instead of 'python3'.`;

  // Replace placeholders in rolePrompt with extraContext values
  if (extraContext.planFile) {
    rolePrompt = rolePrompt.replace(/\{planFile\}/g, extraContext.planFile);
  }

  let finalPrompt = `${rolePrompt}\n\n${baseRules}\n\n${osInfo}`;

  return finalPrompt;
}
