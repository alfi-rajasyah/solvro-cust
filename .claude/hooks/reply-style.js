#!/usr/bin/env node
// SessionStart hook: injects the user's reply-style rules into the MAIN session only.
// SessionStart does not fire for subagents, so solvro-implementor / solvro-reviewer /
// solvro-docs-keeper never see these rules. That is the point — their output is data
// for the orchestrator, not chat for the user.
//
// Everything lives inside this repo. Nothing about reply style belongs in ~/.claude,
// because a CLAUDE.md, a rules file, or an auto-memory line there would reach subagents.
// Source of truth: <repo>/.claude/reply-style.md
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "reply-style.md");

let text;
try {
  text = fs.readFileSync(file, "utf8").trim();
} catch {
  process.exit(0); // file removed on purpose — stay silent, do not break the session
}

if (!text) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  }),
);
