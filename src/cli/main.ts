#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCommands } from "./commands.ts";

function loadEnvFile(filename: string): void {
  const fullPath = resolve(filename);
  if (!existsSync(fullPath)) return;
  try {
    const content = readFileSync(fullPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore unreadable optional env files
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

process.exitCode = await runCommands(process.argv.slice(2), (text) =>
  process.stdout.write(text + "\n"),
);
