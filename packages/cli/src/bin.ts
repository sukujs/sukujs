#!/usr/bin/env node
import { Prompter, run } from './index.js';

// Ask questions only when a person is at a terminal. Piped or scripted runs take defaults.
const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
process.exitCode = await run(
  process.argv.slice(2),
  interactive ? { prompter: new Prompter() } : {},
);
