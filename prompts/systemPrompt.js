import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = new Map();

export function loadSoulPrompt() {
  if (cache.has('soul')) return cache.get('soul');
  const filePath = join(__dirname, 'soul.txt');
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  cache.set('soul', content);
  return content;
}

export function loadProviderPrompt(modelId) {
  const cacheKey = `provider:${modelId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const lower = (modelId || '').toLowerCase();
  let providerFile = 'anthropic.txt';

  if (lower.includes('gemini')) providerFile = 'gemini.txt';
  else if (lower.includes('qwen')) providerFile = 'qwen.txt';
  else if (lower.includes('gpt-5') || lower.includes('codex')) providerFile = 'codex.txt';
  else if (lower.includes('gpt-4') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) providerFile = 'beast.txt';
  else if (lower.includes('trinity')) providerFile = 'trinity.txt';

  const filePath = join(__dirname, 'provider', providerFile);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  cache.set(cacheKey, content);
  return content;
}

export function loadCompactionPrompt() {
  if (cache.has('compaction')) return cache.get('compaction');
  const filePath = join(__dirname, 'compaction.txt');
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  cache.set('compaction', content);
  return content;
}

export function clearSystemPromptCache() {
  cache.clear();
}
