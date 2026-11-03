<img src="mod/.claude-plugin/icon.png" alt="" width="96">

# live-compact

Auto-compaction for Claude Code without the wait.

Claude Code keeps the whole conversation in its context, measured in tokens (small pieces of text). When the context reaches the auto-compact threshold, Claude Code stops and has the model summarize the conversation. You wait until it is done: in our Opus sessions that took 80-160 seconds, once over 4 minutes.

live-compact has the summary written in the background, shortly before the threshold, while you keep working. When auto-compaction starts, the plugin puts the ready summary in place within 8-20 milliseconds and keeps the newest messages unchanged. If no summary is ready, Claude Code runs its standard compaction, as it would without the plugin.

<img src="assets/before-after.gif" alt="Standard auto-compaction blocks the session for 1:38; with live-compact it is done in 0.02 s and you keep typing" width="480">

Illustration with measured times: standard compaction in one of our Opus sessions took 1:38 (the clock in the animation runs 14 times faster); live-compact took 0.008-0.02 s.

> [!IMPORTANT]
> live-compact uses an early-access feature of Claude Code (plugin hooks). You do not need to enable anything, but the feature may change between Claude Code releases. Tested on Windows only.

## How it works

<img src="assets/how-it-works.png" alt="Every 5 s the plugin checks the context size; within 40k tokens of the threshold a background request writes the summary; at auto-compaction a ready summary goes in place within 8-20 ms, otherwise standard compaction runs" width="420">

Terms such as session, skill, hook and subagent are explained in the [Claude Code glossary](https://code.claude.com/docs/en/glossary).

1. Every 5 seconds the plugin checks the context size, and once a minute the auto-compact threshold.
2. When the context comes within 40k tokens of the threshold (or within 20% of the threshold, whichever is smaller), the plugin sends one background request: the same model and the same conversation, asked only to write the summary. Claude keeps working on your request meanwhile.
3. When auto-compaction starts (or you type `/compact` on its own), the plugin replaces the conversation with:
   - a first message with the summary, the path to the session file (where Claude Code saves the full conversation), and the skills used earlier in the session (instructions Claude loaded for a task; newest first, up to 5,000 tokens each and 25,000 in total, the same limits as standard compaction),
   - every message after the last one the background request saw, unchanged, including messages you typed while Claude was working.
4. Otherwise Claude Code runs its standard compaction:
   - no summary is ready yet: the threshold came first, for example after one step that added more than about 40k tokens (several large files read at once), or while the background request was still running;
   - the ready summary was dropped by `/clear`, resuming the session or reloading the plugin;
   - the summary no longer fits the conversation: you went back to an earlier message (`Esc` twice, or `/rewind`) from before the last message the summary covers, the conversation has 4,096 or more messages, or a message you typed while Claude was working has an image or another attachment;
   - `/compact` with your own instructions (for example `/compact keep the test results`), and subagents (helper agents Claude starts for part of a task).

The summary prompt follows the structure of Claude Code's own summary. If your project instructions file (`CLAUDE.md`) has a section on compaction (for example `# Compact instructions`), the summary follows it.

## Requirements

- Claude Code 2.1.300 or later, in the terminal or in the VS Code extension. Tested on 2.1.300, 2.1.301, 2.1.312, 2.1.314, 2.1.316 and 2.1.317; we use it every day in the VS Code extension in Cursor (an editor built on VS Code). To check your version: in the extension, the extension's version number in the Extensions view is the Claude Code version, or type `/status`; in a terminal, run `claude --version`.
- Windows. macOS and Linux are not tested yet. If you try it there, please [tell us how it went](https://github.com/SocialBuzzStudio/live-compact/issues).
- Auto-compaction on. It is on by default ([`autoCompactEnabled`](https://code.claude.com/docs/en/settings-reference#autocompactenabled)), and the plugin uses whatever threshold Claude Code uses.

## Installation

### In a terminal

If you run `claude` in a terminal:

```
claude plugin install live-compact --marketplace SocialBuzzStudio/live-compact
```

This adds this repository as a plugin source (the `socialbuzzstudio` marketplace) and installs the plugin, whose full name is `live-compact@socialbuzzstudio`. Then start `claude` again in the sessions that were already open.

### In the VS Code extension

If you use only the Claude Code panel in VS Code or Cursor (the extension does not add `claude` to your terminal):

1. Type `/plugins` in the prompt box. The **Manage plugins** window opens.
2. On the **Marketplaces** tab, enter `SocialBuzzStudio/live-compact` in the "GitHub repo, URL, or path" field and click **Add**.
3. On the **Plugins** tab, click **Install** next to live-compact and choose **Install for you**.

The change applies right away to the conversations open in that window. If the window shows "Restart Claude to apply plugin changes", click it. A new conversation always starts with the plugin.

## Check that it works

1. Installed: `claude plugin list` shows `live-compact@socialbuzzstudio` with `Status: ✔ enabled`. In the extension: live-compact is on in the **Plugins** tab of `/plugins`.
2. Active: start a new conversation, send one short message, then type `/compact`. The line `live-compact: no summary ready yet; standard compaction` appears (in the extension it starts with `live-compact plugin:`). This only compacts that short test conversation.
3. Working: at every auto-compaction a line starting with `live-compact:` appears, and when the plugin's summary is used, compaction takes a moment instead of minutes. No such line after an auto-compaction means the plugin was not active in that conversation.

The model does not see these lines, and they are not saved in the session file.

| Line | Meaning |
| --- | --- |
| `live-compact: compacted with the summary prepared in the background; N recent messages kept verbatim; skills carried over: S` | The plugin compacted: N messages after the summary kept verbatim (unchanged), S skills carried over |
| `live-compact: no summary ready yet; standard compaction` | No summary was ready (step 4 above). A `/compact` early in a conversation always gives this line |
| `live-compact: summary not used (<reason>); standard compaction` | The summary no longer fits: `anchor-missing` (you went back to an earlier message), `too-long` (4,096 or more messages), `image-sent-during-turn` (a message you typed while Claude was working has an image or another attachment) |
| `live-compact: background summary failed: <reason>` | The background request failed (for example `api-error 529`, or an error message). Nothing else changes: it tries again after another 20k tokens, and until then Claude Code uses standard compaction |

After `/compact` with your own instructions, and in subagents, there is no line: those always use standard compaction.

> [!NOTE]
> The first message after compaction looks as if you had sent it ("This session is being continued from a previous conversation..."). It is the summary: plugins cannot mark a message as a compaction summary the way Claude Code does.

## Cost and privacy

The plugin is free (MIT license: free to use and change). For each compaction it sends one background request with the whole conversation, about what standard compaction itself would send; most of it usually comes from the prompt cache, which costs less than new input. On a Claude subscription it counts toward your plan's usage limits like any other request in the session; with an API key it is billed like one. When compaction uses the summary, it takes the place of the standard compaction request, so the total stays about the same. The request is extra when its summary goes unused: after `/clear`, when the session ends before compaction, or when compaction is standard after all. A failed request is tried again after another 20k tokens.

The plugin sends the conversation only where Claude Code already sends it: the same model, through Claude Code's own model call (Anthropic's Claude API, unless you set up another provider such as Amazon Bedrock). It writes no files unless you turn on the event log, which holds counts, times and reasons, no conversation text. Details: [what it runs, sends and stores](mod/README.md#what-it-runs-sends-and-stores).

## Limitations

- After the plugin compacts, the context is larger than after standard compaction: the messages after the summary stay unchanged, usually up to about 40k tokens, so the next compaction comes sooner.
- Images in tool results among the messages kept after compaction are dropped; their text stays. A message with an image that you type while Claude is working leads to standard compaction instead, so that image is not lost.
- If you set up your own hooks that run before or after compaction (`PreCompact` or `PostCompact` in `settings.json`), they may not run when the plugin compacts.
- In our everyday sessions on 2 and 3 November 2026 (test sessions not counted), 14 of 17 auto-compactions used the plugin's summary. In the other 3, the summary was not ready yet.
- If the plugin was installed or reloaded while a conversation was open, the first message after compaction in that conversation has no path to the session file.
- Not yet verified:
  - whether tools that Claude loads on demand need to be loaded again after compaction;
  - whether, after you resume a session, a later standard compaction carries the full skill texts from the plugin's first message.

## Update, disable or remove

### In a terminal

Update, then start `claude` again:

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

In a running session, turning it off or removing it applies after `/reload-plugins` or a restart.

### In the VS Code extension

Type `/plugins`. On the **Plugins** tab, next to live-compact: the switch turns it off, the update button ("Update plugin to the latest version") updates it, and the uninstall button removes it. To remove the marketplace too, use the remove button next to `socialbuzzstudio` on the **Marketplaces** tab. Changes apply right away.

If you set `LIVE_COMPACT_LOG_DIR`, remove it from `settings.json` and delete the log folder yourself.

## Event log

Optional, for troubleshooting. Add `LIVE_COMPACT_LOG_DIR` to the `env` section of `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`). If the file already has an `"env"` section, add the line inside it. Replace `you` with your Windows user name; the folder is created automatically.

```json
{ "env": { "LIVE_COMPACT_LOG_DIR": "C:/Users/you/claude-logs" } }
```

New conversations then write one JSON line per event to `<session id>.jsonl`, one file per conversation (the newest file is the current one). The log holds counts, times and reasons, no conversation text. Without the setting, the plugin writes nothing to disk.

Each line has `t` (time in ms) and `ev`:

| `ev` | When, and its fields |
| --- | --- |
| `fork-start` | The background request started: `tokens` (context size), `threshold` |
| `fork-end` | It ended: `ms`; `chars` (summary length) or `reason` (failure); `stale` (a compaction, `/clear` or resume came first); `usage`, `ctx` (input tokens) |
| `compact` | A compaction: `trigger` (`auto` or `manual`), `prepared` (a summary was ready), `own` (the plugin compacted), `kept` (messages kept unchanged), `of` (all messages), `tail` (tokens added since the background request started), `reason`; with `own` also `skills`, `skillsOmitted`, `skillCalls`; `sentDuringTurn` (tool results that a message you typed while Claude was working came with) |
| `tick-error` | A check failed: `message` |

## Help and license

If compaction takes minutes again and no `live-compact:` line appears, or you see errors from live-compact, turn the plugin off (above) and tell us in [GitHub Issues](https://github.com/SocialBuzzStudio/live-compact/issues). Claude Code may change the plugin feature in an update; we have not tested what happens to live-compact then.

Made by SocialBuzzStudio, not affiliated with Anthropic. MIT license, see [LICENSE](LICENSE).

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
- [assets/how-it-works.mmd](assets/how-it-works.mmd): source of the diagram
- [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json): the `socialbuzzstudio` marketplace
