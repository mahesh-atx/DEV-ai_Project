import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
const GLOBAL_CONFIG_DIR = join(homedir(), '.config', 'kilo');

export async function loadInstructionFiles(projectRoot) {
  const files = [];

  for (const fileName of INSTRUCTION_FILES) {
    const projectPath = resolve(projectRoot, fileName);
    const globalPath = resolve(GLOBAL_CONFIG_DIR, fileName);

    if (existsSync(projectPath)) {
      try {
        const content = readFileSync(projectPath, 'utf-8');
        files.push({
          name: fileName,
          source: 'project',
          path: projectPath,
          content
        });
      } catch (e) {
        // Skip if can't read
      }
    }

    if (existsSync(globalPath)) {
      try {
        const content = readFileSync(globalPath, 'utf-8');
        files.push({
          name: fileName,
          source: 'global',
          path: globalPath,
          content
        });
      } catch (e) {
        // Skip if can't read
      }
    }
  }

  return files;
}

export function formatInstructionFiles(files) {
  if (files.length === 0) return '';

  const sections = files.map(f => {
    return `# ${f.name} (from ${f.source})\n\n${f.content}`;
  });

  return '\n\n---\n\n' + sections.join('\n\n---\n\n');
}

export async function buildInstructionPrompt(projectRoot) {
  const files = await loadInstructionFiles(projectRoot);
  return formatInstructionFiles(files);
}
