#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const tuiScript = path.resolve(projectRoot, 'tui-main.jsx');

// Load .env from the project root so API key is available from any directory
const projectEnvPath = path.join(projectRoot, '.env');
if (fs.existsSync(projectEnvPath)) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: projectEnvPath });
}

// Use npx tsx to execute the TUI
const result = spawnSync('npx', ['tsx', tuiScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status || 0);
