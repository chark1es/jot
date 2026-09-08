#!/usr/bin/env bun

const target = process.argv[2];

const commands: Record<string, string> = {
  mobile: "bun run dev:mobile",
  desktop: "bun run dev:desktop",
  "editor-lab": "bun run dev:editor-lab",
};

if (target === undefined) {
  process.stderr.write(
    "Choose a target this host can actually run: mobile | desktop | editor-lab\n",
  );
  process.exit(1);
}

const command = commands[target];
if (command === undefined) {
  process.stderr.write(`Unknown target "${target}". Use mobile, desktop, or editor-lab.\n`);
  process.exit(1);
}

const proc = Bun.spawn(command.split(" "), { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
const code = await proc.exited;
process.exit(code);
