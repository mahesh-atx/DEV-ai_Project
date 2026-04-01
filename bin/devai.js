#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tuiScript = path.resolve(__dirname, '../tui-main.jsx');

// Use npx tsx to execute the new TUI
const result = spawnSync('npx', ['tsx', tuiScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status || 0);
