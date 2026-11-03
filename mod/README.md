# live-compact

Auto-compaction for Claude Code without the wait. When the context comes within 40k tokens of the auto-compact threshold, the plugin asks the session's own model for a summary in the background. When auto-compaction starts, it swaps that summary in within milliseconds and keeps the newest messages word for word. If no summary is ready, Claude Code compacts the usual way.

Install, then restart running sessions:

```bash
claude plugin install live-compact --marketplace SocialBuzzStudio/live-compact
```

Full documentation: https://github.com/SocialBuzzStudio/live-compact

## What it runs, sends and stores

- Runs one hooks module (`hooks/register.ts`) inside Claude Code. It starts no processes and installs no packages.
- Sends one background request per compaction through Claude Code's own model call (`$.model.fork`), to the same Claude API and with the same conversation that standard compaction would send. It contacts no other service.
- Stores nothing by default. Only if you set `LIVE_COMPACT_LOG_DIR` does it write one JSON line per event to `<session id>.jsonl` in that folder: token counts, timings and reasons, without conversation text. It writes no other file: no settings, instructions, build or start-up files.

## Hooks

- `session.start`: starts a 5-second timer that reads the context size and the auto-compact threshold. Passes the event through unchanged.
- `classic.SessionStart`: reads the transcript path, which goes into the summary message, and drops a ready summary after `/clear` or a resumed session. Passes the event through unchanged; it does not touch settings, instructions or other hooks.
- `session.compact`: on auto-compaction, or `/compact` without instructions, replaces the conversation with the ready summary and the newest messages verbatim. Without a ready summary, with `/compact` instructions, and for subagents it calls the standard compaction unchanged. It skips Claude Code's own background precompute of the summary, because the plugin writes that summary itself.
