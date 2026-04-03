import {
  discoverInstructionDocs,
  renderInstructionFiles,
} from '../engine/prompt/instructions.js';

export async function loadInstructionFiles(projectRoot) {
  return discoverInstructionDocs(projectRoot || process.cwd());
}

export function formatInstructionFiles(files) {
  return renderInstructionFiles(files || []);
}

export async function buildInstructionPrompt(projectRoot) {
  const files = await loadInstructionFiles(projectRoot);
  return formatInstructionFiles(files);
}
