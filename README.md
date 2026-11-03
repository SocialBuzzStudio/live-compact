<img src="mod/.claude-plugin/icon.png" alt="" width="96">

# live-compact

Auto-compaction for Claude Code without the wait.

When a long session reaches the auto-compact threshold (the context size at which Claude Code compacts), Claude Code stops and has the model summarize the conversation. You wait until it is done: in our Opus sessions that took 80-160 seconds, once over 4 minutes.

live-compact has the summary written in the background, shortly before the threshold, while you keep working. When auto-compaction starts, the plugin puts the ready summary in place in 8-20 ms and keeps the newest messages unchanged. If no summary is ready, Claude Code runs its standard compaction, as it would without the plugin.

<img src="assets/before-after.gif" alt="Standard auto-compaction blocks the session for 1:38; with live-compact it is done in 0.02 s and you keep typing" width="480">

Illustration with measured times: standard compaction in one of our Opus sessions took 1:38 (the clock in the animation runs 14 times faster); live-compact took 0.008-0.02 s.

> [!IMPORTANT]
> live-compact is built on Claude Code's plugin hook API, which is in early access: there is nothing to turn on, but the API may change between Claude Code releases. Tested on Windows only.

## How it works

<img src="assets/how-it-works.png" alt="Every 5 s the plugin checks the context size; within 40k tokens of the threshold a background request writes the summary; at auto-compaction a ready summary goes in place in 8-20 ms, otherwise standard compaction runs" width="420">

Diagram source: [assets/how-it-works.mmd](assets/how-it-works.mmd).

1. Every 5 seconds the plugin checks the context size, and once a minute the auto-compact threshold.
2. When the context comes within 40k tokens of the threshold (or within 20% of the threshold, whichever is smaller), the plugin sends one background request: the same model and the same conversation, asked only to write the summary. Claude keeps working on your request meanwhile.
3. When auto-compaction starts (or you run `/compact` with no instructions), the plugin replaces the conversation with:
   - a first message with the summary, the path to the session file with the full conversation, and the skills used earlier in the session (newest first, up to 5,000 tokens each and 25,000 in total, the same limits as standard compaction),
   - every message after the last one the background request saw, unchanged, including messages you typed while Claude was working.
4. Otherwise Claude Code runs its standard compaction:
   - no summary is ready yet: the threshold came first, for example after one step that added more than about 40k tokens (several large files read at once), or while the background request was still running;
   - the ready summary was dropped by `/clear`, resuming the session or reloading the plugin;
   - the summary no longer fits: you rewound the conversation to before that last message, it has 4,096 or more messages, or a message you typed while Claude was working has an image or another attachment;
   - `/compact` with instructions, and subagents (helper agents Claude starts for part of a task).

The summary prompt follows the structure of Claude Code's own summary. If your `CLAUDE.md` has a section on compaction (for example `# Compact instructions`), the summary follows it.

## Requirements

- Claude Code 2.1.300 or later, in the terminal or in the VS Code extension. Tested on 2.1.300, 2.1.301, 2.1.312, 2.1.314, 2.1.316 and 2.1.317; we use it every day in the extension in Cursor. Check your version with `claude --version`, or `/status` in the extension.
- Windows. macOS and Linux are not tested yet. If you try it there, please [tell us how it went](https://github.com/SocialBuzzStudio/live-compact/issues).
- Auto-compaction on (the default). The plugin uses whatever threshold Claude Code uses, so `autoCompactWindow` and `/autocompact` keep working.

## Installation

In a terminal:

```
claude plugin install live-compact --marketplace SocialBuzzStudio/live-compact
```

This adds this repository as a plugin source (the `socialbuzzstudio` marketplace) and installs the plugin, whose full name is `live-compact@socialbuzzstudio`.

In the VS Code extension, which does not add `claude` to your terminal: type `/plugins` in the prompt box, add `SocialBuzzStudio/live-compact` on the **Marketplaces** tab, then click **Install** next to live-compact on the **Plugins** tab and choose **Install for you**.

Then restart the sessions that were already open: in a terminal, start `claude` again; in VS Code, run **Developer: Reload Window**.

## Check that it works

1. `claude plugin list` shows `live-compact@socialbuzzstudio` as `enabled` (in VS Code: the **Plugins** tab of `/plugins`).
2. At the first auto-compaction, a dim line appears in the conversation. The model does not see it, and it is not saved in the session file.
3. To see the plugin at work earlier, turn on the [event log](#event-log): a `fork-start` line means the background request has started.

| Line | Meaning |
| --- | --- |
| `live-compact: compacted with the summary prepared in the background; N recent messages kept verbatim; skills carried over: S` | The plugin compacted: N messages after the summary kept unchanged, S skills carried over |
| `live-compact: no summary ready yet; standard compaction` | No summary was ready (step 4 above). A `/compact` early in a session always gives this line |
| `live-compact: summary not used (<reason>); standard compaction` | The summary no longer fits: `anchor-missing` (you rewound the conversation), `too-long` (4,096 or more messages), `image-sent-during-turn` (a message you typed while Claude was working has an image or another attachment) |
| `live-compact: background summary failed: <reason>` | The background request failed (`api-error <status>`, `empty-reply`, `nothing-to-fork`, or an error message). Nothing else changes: it tries again after another 20k tokens, and until then compaction is standard |

After `/compact` with instructions, and in subagents, there is no line: those always use standard compaction.

> [!NOTE]
> The first message after compaction looks as if you had sent it ("This session is being continued from a previous conversation..."). It is the summary: plugins cannot mark a message as a compaction summary the way Claude Code does.

## Cost and privacy

The plugin is free (MIT license). It sends one background request per compaction: the conversation and the summary prompt, to the same model, mostly served from the prompt cache (input the API has already processed, which costs less than new input). When compaction uses that summary, it takes the place of the standard compaction request, so the cost is about the same. The request is extra when its summary goes unused: after `/clear`, when the session ends before compaction, or when compaction is standard after all. A failed request is tried again after another 20k tokens.

The plugin talks only to the Claude API, through Claude Code's own model call, and writes no files unless you turn on the event log. Details: [what it runs, sends and stores](mod/README.md#what-it-runs-sends-and-stores).

## Limitations

- After the plugin compacts, the context is larger than after standard compaction: the messages after the summary stay unchanged, usually up to about 40k tokens, so the next compaction comes sooner.
- Images in the messages kept after compaction are dropped. Text, including tool results, stays.
- If you have your own `PreCompact` or `PostCompact` hooks in `settings.json`, they may not run when the plugin compacts.
- In our sessions on 2 and 3 November 2026, 16 of 21 auto-compactions used the plugin's summary. In the other 5, the summary was not ready yet.
- After `/reload-plugins` in a running session, the first message after compaction has no path to the session file until the session restarts.
- Not yet verified:
  - whether the VS Code extension shows the `live-compact:` lines;
  - whether tools that Claude loaded on demand (with `ToolSearch`) before compaction need to be loaded again;
  - whether, after you resume a session, a later standard compaction carries the full skill texts from the plugin's first message.

## Update, disable or remove

Update, then restart the session:

```
claude plugin update live-compact@socialbuzzstudio
```

Turn it off and go back to standard compaction:

```
claude plugin disable live-compact@socialbuzzstudio
```

Remove it, together with its marketplace:

```
claude plugin uninstall live-compact@socialbuzzstudio
claude plugin marketplace remove socialbuzzstudio
```

In the VS Code extension, use `/plugins`: the switch next to live-compact turns it off, the trash icon removes it. In a terminal session the change applies after `/reload-plugins` or a restart. If you set `LIVE_COMPACT_LOG_DIR`, remove it from `settings.json` and delete the log folder yourself.

## Event log

Optional, for troubleshooting. Set `LIVE_COMPACT_LOG_DIR` to a folder to get one JSON line per event in `<session id>.jsonl`. Without it, the plugin writes nothing to disk. To log in every session, add it to `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`):

```json
{ "env": { "LIVE_COMPACT_LOG_DIR": "C:/Users/you/claude-logs" } }
```

Each line has `t` (time in ms) and `ev`:

| `ev` | When, and its fields |
| --- | --- |
| `fork-start` | The background request started: `tokens` (context size), `threshold` |
| `fork-end` | It ended: `ms`; `chars` (summary length) or `reason` (failure); `stale` (a compaction, `/clear` or resume came first); `usage`, `ctx` (input tokens) |
| `compact` | A compaction: `trigger` (`auto` or `manual`), `prepared` (a summary was ready), `own` (the plugin compacted), `kept` (messages kept unchanged), `of` (all messages), `tail` (tokens added since the background request started), `reason`; with `own` also `skills`, `skillsOmitted`, `skillCalls`; `sentDuringTurn` (tool results that a message you typed while Claude was working came with) |
| `tick-error` | A check failed: `message` |

## Help and license

Questions and problems: [GitHub Issues](https://github.com/SocialBuzzStudio/live-compact/issues). Made by SocialBuzzStudio, not affiliated with Anthropic. MIT license, see [LICENSE](LICENSE).

## Development

```
git clone https://github.com/SocialBuzzStudio/live-compact
cd live-compact
claude plugin test mod
claude plugin validate mod
claude --plugin-dir ./mod
```

`plugin test` runs the tests without model calls; `--plugin-dir` starts a session with the plugin loaded from this folder. `mod/` is the plugin itself:

- [mod/hooks/register.ts](mod/hooks/register.ts): hooks, checks, background request, event log
- [mod/hooks/compaction.ts](mod/hooks/compaction.ts): the messages kept after compaction
- [mod/hooks/skills.ts](mod/hooks/skills.ts): skills carried over to the first message
- [mod/hooks/summary-prompt.ts](mod/hooks/summary-prompt.ts): the summary prompt and the first message
- [mod/tests/](mod/tests/): tests
- [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json): the `socialbuzzstudio` marketplace
