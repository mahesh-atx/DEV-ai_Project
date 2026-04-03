import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

const cache = new Map();

export function loadToolPrompt(toolName) {
  if (cache.has(toolName)) {
    return cache.get(toolName);
  }

  const filePath = join(PROMPTS_DIR, `${toolName}.txt`);
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  cache.set(toolName, content);
  return content;
}

export function loadAllToolPrompts() {
  const prompts = {};
  const toolNames = [
    'bash', 'read', 'write', 'edit', 'multiedit',
    'glob', 'grep', 'list', 'task', 'question',
    'webfetch', 'websearch', 'apply_patch', 'batch',
    'codesearch', 'todowrite', 'todoread', 'plan_exit',
    'codebase_search', 'lsp', 'send_user_message', 'structured_output'
  ];

  for (const name of toolNames) {
    const prompt = loadToolPrompt(name);
    if (prompt) {
      prompts[name] = prompt;
    }
  }

  return prompts;
}

export function clearToolPromptCache() {
  cache.clear();
}
