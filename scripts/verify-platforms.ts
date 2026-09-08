#!/usr/bin/env bun

process.stdout.write(
  [
    "verify:platforms does not build four native apps on one host.",
    "Use GitHub Actions workflows:",
    "  .github/workflows/ci.yml       shared lint, types, schema, tests",
    "  .github/workflows/mobile.yml   iOS simulator and Android emulator",
    "  .github/workflows/desktop.yml  macOS and Windows Tauri builds",
    "",
  ].join("\n"),
);
