#!/usr/bin/env node
import { main } from "./main.js";

const result = main(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.code);
