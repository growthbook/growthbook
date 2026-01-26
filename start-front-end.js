#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const { spawn } = require("child_process");
const path = require("path");

const nextBin = path.join(
  __dirname,
  "packages/front-end/node_modules/next/dist/bin/next",
);
const cwd = path.join(__dirname, "packages/front-end");

const child = spawn("node", [nextBin, "start"], {
  cwd: cwd,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code);
});
