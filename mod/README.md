# live-compact

Auto-compaction for Claude Code without the wait. Shortly before the auto-compact threshold, the plugin asks the session's own model for a summary in the background. When auto-compaction starts, it puts that summary in place in milliseconds and keeps the newest messages unchanged. If no summary is ready, Claude Code runs its standard compaction.

Built on Claude Code's plugin hook API, which is in early access, and tested on Windows only. Requirements, limitations, and how to disable or remove the plugin: [full documentation](https://github.com/SocialBuzzStudio/live-compact).

Install in a terminal, then restart running sessions:

```
claude plugin install live-compact --marketplace SocialBuzzStudio/live-compact
```

## What it runs, sends and stores

- Runs one hooks module (`hooks/register.ts`) inside Claude Code. It starts no processes and installs no packages.
- Sends one background request per compaction through Claude Code's own model call (`$.model.fork`), to the same Claude API and with the same conversation that standard compaction would send. If that request fails, it is sent again after another 20k tokens; if its summary goes unused (for example after `/clear`), the request was extra. It contacts no other service.
- Stores nothing by default. Only if you set `LIVE_COMPACT_LOG_DIR` does it write one JSON line per event to `<session id>.jsonl` in that folder: token counts, timings and reasons, without conversation text. It writes no other file: no settings, instructions, build or start-up files.

## Hooks

- `session.start`: starts a 5-second timer that checks the context size (and, once a minute, the auto-compact threshold). Passes the event through unchanged.
- `classic.SessionStart`: reads the path of the session file, which goes into the summary message, and drops a ready summary after `/clear` or a resumed session. Passes the event through unchanged; it does not touch settings, instructions or other hooks.
- `prompt.submit`: notes whether a prompt typed while Claude is working has an image or another attachment. Passes the prompt through unchanged.
- `session.append`: notes the newest tool result and the text of each message typed while Claude is working, which Claude Code files beside that result, so compaction keeps it. Passes every row through unchanged.
- `session.compact`: on auto-compaction, or `/compact` without instructions, replaces the conversation with the ready summary and the newest messages unchanged. Without a ready summary, with `/compact` instructions, and for subagents it calls the standard compaction unchanged. Some Claude Code versions prepare a summary of their own in the background (the `precompute` trigger); the plugin skips that one, because it writes the summary itself.
