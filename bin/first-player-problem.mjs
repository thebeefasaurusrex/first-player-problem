#!/usr/bin/env node
import { table } from '../table/cli.mjs';

const args = process.argv.slice(2);
if (!args.length || ['--help', '-h'].includes(args[0])) {
  console.log('Usage: first-player-problem run|sweep <adapter.mjs> [--games N] [--seed S] [--seats a,b,c] [--dial name=a,b]');
  console.log('       first-player-problem compare <a.json> <b.json> [--full]');
} else {
  try {
    process.exitCode = await table(args);
  } catch (error) {
    console.error('First Player Problem: ' + error.message);
    process.exitCode = 2;
  }
}
