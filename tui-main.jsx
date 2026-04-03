#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();
import { injectApiKeysToEnv } from './utils/configManager.js';
injectApiKeysToEnv();
import React from 'react';
import { render } from 'ink';
import App from './tui/app.jsx';

const enterAltScreenCommand = '\x1b[?1049h';
const leaveAltScreenCommand = '\x1b[?1049l';

process.stdout.write(enterAltScreenCommand);

const exitAltScreen = () => {
  process.stdout.write(leaveAltScreenCommand);
};

process.on('exit', exitAltScreen);
process.on('SIGINT', () => { exitAltScreen(); process.exit(0); });
process.on('SIGTERM', () => { exitAltScreen(); process.exit(0); });
process.on('uncaughtException', (err) => { 
  exitAltScreen(); 
  console.error(err); 
  process.exit(1); 
});

render(<App />);
