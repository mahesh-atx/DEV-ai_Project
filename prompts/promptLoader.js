import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadRolePromptSection(role, extraContext = {}) {
  const rolePath = path.join(__dirname, `${role}.txt`);
  let rolePrompt = '';

  try {
    rolePrompt = fs.readFileSync(rolePath, 'utf8');
  } catch {
    rolePrompt = 'You are RootX, an elite autonomous AI software engineer. Your ultimate goal is to complete the user\'s request using tools.';
  }

  if (extraContext.planFile) {
    rolePrompt = rolePrompt.replace(/\{planFile\}/g, extraContext.planFile);
  }

  return rolePrompt.trim();
}

export function loadPrompt(role, modelConfig = {}, extraContext = {}) {
  return loadRolePromptSection(role, extraContext);
}
