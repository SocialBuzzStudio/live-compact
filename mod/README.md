# live-compact

Auto-compaction for Claude Code without the wait. Shortly before the auto-compact threshold, the plugin asks the session's own model for a summary in the background. When auto-compaction starts, it puts that summary in place within milliseconds and keeps the newest messages unchanged. If no summary is ready, Claude Code runs its standard compaction.

Uses an early-access feature of Claude Code (plugin hooks); tested on Windows only. Installation in a terminal or in the VS Code extension, requirements, limitations, and how to disable or remove the plugin: [full documentation](https://github.com/SocialBuzzStudio/live-compact#installation).

## What it runs, sends and stores

- Runs one code file (`hooks/register.ts`) inside Claude Code. It starts no programs and installs nothing.
- Sends the conversation only where Claude Code already sends it: one background request per compaction to the same model, through Claude Code's own model call, the same content standard compaction would send. If that request fails, it is sent again after another 20k tokens; if its summary goes unused (for example after `/clear`), the request was extra. It contacts no other service.
- Stores nothing by default. Only if you set `LIVE_COMPACT_LOG_DIR` does it write one line per event to `<session id>.jsonl` in that folder: counts, times and reasons, no conversation text. It changes no settings or other files.

## Hooks

For developers and reviewers: the Claude Code events the plugin uses.

- `session.start`: starts a 5-second timer that checks the context size (and, once a minute, the auto-compact threshold). Passes the event through unchanged.
- `classic.SessionStart`: reads the path of the session file, which goes into the summary message, and drops a ready summary after `/clear` or a resumed session. Passes the event through unchanged; it does not touch settings, instructions or other hooks.
- `prompt.submit`: notes whether a prompt typed while Claude is working has an image or another attachment. Passes the prompt through unchanged.
- `session.append`: notes the newest tool result and the text of each message typed while Claude is working, which Claude Code files beside that result, so compaction keeps it. Passes every row through unchanged.
- `session.compact`: on auto-compaction, or `/compact` without instructions, replaces the conversation with the ready summary and the newest messages unchanged. Without a ready summary, with `/compact` instructions, and for subagents it calls the standard compaction unchanged. Some Claude Code versions prepare a summary of their own in the background (the `precompute` trigger); the plugin skips that one, because it writes the summary itself.
