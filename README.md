<img src="mod/.claude-plugin/icon.png" alt="" width="96">

# live-compact

Auto-compaction for Claude Code without the wait. Made by SocialBuzzStudio for anyone whose long Claude Code conversations stop for minutes at auto-compaction.

Claude Code keeps the whole conversation in its context, measured in tokens (small pieces of text). When the context reaches the auto-compact threshold, Claude Code stops and has the model summarize the conversation. You wait until it is done: in our Opus sessions that took 80-160 seconds, once over 4 minutes.

live-compact has the summary written in the background, shortly before the threshold, while you keep working. When auto-compaction starts, the plugin replaces the conversation with that summary and the newest messages, unchanged, within 8-20 milliseconds. If no summary is ready, Claude Code runs its standard compaction, as it would without the plugin.

<img src="assets/before-after.gif" alt="Standard auto-compaction blocks the conversation for 1:38; with live-compact it is done in 0.02 s and you keep typing" width="480">

Terminal-style illustration with measured times: standard compaction in one of our Opus sessions took 1:38 (the clock in the animation runs 14 times faster); live-compact took 0.008-0.02 s.

> [!IMPORTANT]
> live-compact is a [mod](https://code.claude.com/docs/en/plugins/mods/overview): a plugin whose code runs inside Claude Code. Mods are on by default (Claude Code 2.1.287 or later), so you do not need to enable anything. Tested on Windows only.

## How it works

<img src="assets/how-it-works.png" alt="Every 5 seconds the plugin checks the context size; close to the threshold a background request writes the summary; at auto-compaction a ready summary replaces the conversation within 8-20 milliseconds, otherwise standard compaction runs" width="420">

Terms such as session, skill and subagent are explained in the [Claude Code glossary](https://code.claude.com/docs/en/glossary).

1. Every 5 seconds the plugin checks the context size, and once a minute the auto-compact threshold.
2. When the context comes within 40,000 tokens of the threshold (or within 20% of the threshold, whichever is smaller), the plugin sends one background request: the same model and the same conversation, asked only to write the summary. Claude keeps working on your request meanwhile.
3. When auto-compaction starts (or you type `/compact` on its own), the plugin replaces the conversation with:
   - a first message with the summary, the path to the session file (where Claude Code saves the full conversation), and the skills used earlier in the conversation (instructions Claude loaded for a task; newest first, up to 5,000 tokens each and 25,000 in total, the same limits as standard compaction),
   - every message after the last one the background request saw, unchanged, including messages you typed while Claude was working.
4. Otherwise Claude Code runs its standard compaction:
   - no summary is ready yet: the context reached the threshold before the summary was finished, for example after one step that added more than about 40,000 tokens (several large files read at once);
   - the ready summary was dropped by `/clear`, by resuming the conversation or by reloading the plugin;
   - the summary no longer fits the conversation: you went back (`Esc` twice, or `/rewind`) to a message the summary already covers, the conversation has 4,096 or more messages, or a message you typed while Claude was working has an image or another attachment;
   - `/compact` with your own instructions (for example `/compact keep the test results`), and subagents (helper agents Claude starts for part of a task).

The summary prompt follows the structure of Claude Code's own summary. If your project instructions file (`CLAUDE.md`) has a section on compaction (for example `# Compact instructions`), the summary follows it.

## Requirements

- Claude Code 2.1.300 or later, in the terminal or in the VS Code extension (in the extension 2.1.304 or later if Claude Code runs through a cloud provider such as Amazon Bedrock). Tested on 2.1.300, 2.1.301, 2.1.312, 2.1.314, 2.1.316 and 2.1.317; we use it every day in the VS Code extension in Cursor (an editor built on VS Code).
- Your version: in VS Code, open the Extensions view (`Ctrl+Shift+X`) and find Claude Code; its version is the Claude Code version (or type `/status` in the panel). In a terminal, run `claude --version`. If it is older, update the extension, or [update Claude Code](https://code.claude.com/docs/en/setup#update-claude-code).
- Windows. macOS and Linux are not tested yet. If you try it there, please [tell us how it went](https://github.com/SocialBuzzStudio/live-compact/issues).
- Auto-compaction on. It is on by default ([`autoCompactEnabled`](https://code.claude.com/docs/en/settings-reference#autocompactenabled)), and the plugin uses whatever threshold Claude Code uses.

## Installation

A marketplace is a catalog of plugins. This repository is one, named `socialbuzzstudio`, so the plugin's full name is `live-compact@socialbuzzstudio`.

### In a terminal

If you run `claude` in a terminal:

```
claude plugin install live-compact --marketplace SocialBuzzStudio/live-compact
```

This adds the marketplace and installs the plugin. Open conversations load it after `/reload-plugins` or a restart; a new conversation starts with it.

### In the VS Code extension

If you use only the Claude Code panel in VS Code or Cursor (the extension does not add `claude` to your terminal):

1. Type `/plugins` in the prompt box. The **Manage plugins** window opens.
2. On the **Marketplaces** tab, enter `SocialBuzzStudio/live-compact` in the "GitHub repo, URL, or path" field and click **Add**.
3. On the **Plugins** tab, click **Install** next to live-compact and choose **Install for you**.

The change applies right away to the conversations open in that window, but start a new conversation if you can (see [Limitations](#limitations)).

## Check that it works

The plugin reports each compaction with one line in the conversation: in a terminal a dimmed line starting with `live-compact:`, in the VS Code panel a grey italic line under the tool calls, starting with `live-compact plugin: live-compact:`. The model does not see these lines, and they are not saved in the session file.

1. Installed: `claude plugin list` shows `live-compact@socialbuzzstudio` with `Status: ✔ enabled`. In the extension: live-compact is on in the **Plugins** tab of `/plugins`.
2. Active: start a new conversation, send one short message, then type `/compact`. The line `live-compact: no summary ready yet; standard compaction` appears. This only compacts that short test conversation.
3. Working: at every auto-compaction such a line appears, and when the plugin's summary is used, compaction takes a moment instead of minutes. No line after an auto-compaction means the plugin was not active in that conversation. A notice about a summary written while you were away is Claude Code's idle compaction, not the plugin's.

| Line | Meaning |
| --- | --- |
| `live-compact: compacted with the summary prepared in the background; N recent messages kept verbatim; skills carried over: S` | The plugin compacted: N messages after the summary kept verbatim (unchanged), S skills carried over |
| `live-compact: no summary ready yet; standard compaction` | No summary was ready (step 4 above). A `/compact` early in a conversation always gives this line |
| `live-compact: summary not used (<reason>); standard compaction` | The summary no longer fits: `anchor-missing` (you went back to an earlier message), `too-long` (4,096 or more messages), `image-sent-during-turn` (a message you typed while Claude was working has an image or another attachment) |
| `live-compact: background summary failed: <reason>` | The background request failed (for example `api-error 529`, or an error message). Nothing else changes: it tries again after another 20,000 tokens, and until then Claude Code uses standard compaction. No need to turn the plugin off |

After `/compact` with your own instructions, and in subagents, there is no line: those always use standard compaction.

> [!NOTE]
> The first message after compaction looks as if you had sent it ("This session is being continued from a previous conversation..."). It is the summary: plugins cannot mark a message as a compaction summary the way Claude Code does.

## Cost and privacy

The plugin is free (MIT license: free to use and change). For each compaction it sends one background request that reads the whole conversation and writes the summary. In our conversations that meant reading about 330,000 tokens, almost all from the prompt cache (input Claude has already processed, which costs much less), and writing about 12,000. On a Claude subscription it counts toward your plan's usage limits like any other request; with an API key it is billed like one. We have not measured what share of a plan's limit it uses.

When compaction uses the summary, it takes the place of the request standard compaction would make, so one compaction costs about the same. The request is wasted when its summary is not used: after `/clear`, when the conversation ends before compaction, or when compaction is standard after all. A failed request is tried again after another 20,000 tokens. Because the context stays larger after the plugin compacts, the next compaction comes sooner (see [Limitations](#limitations)).

The plugin sends the conversation only where Claude Code already sends it: the same model, through Claude Code's own model call (Anthropic's Claude API, unless you set up another provider such as Amazon Bedrock). It writes no files unless you turn on the event log, which holds counts, times and reasons, no conversation text. As a mod, its code runs with your permissions: you can read it in [mod/hooks/](mod/hooks/), and after cloning, `claude plugin validate mod` lists what it hooks and calls. Details: [what it runs, sends and stores](mod/README.md#what-it-runs-sends-and-stores).

## Limitations

- After the plugin compacts, the context is larger than after standard compaction: the messages after the summary stay unchanged, usually up to about 40,000 tokens, so the next compaction comes sooner.
- Images in tool results among the messages kept after compaction are dropped; their text stays. A message with an image that you type while Claude is working leads to standard compaction instead, so that image is not lost.
- If you set up your own hooks that run before or after compaction (`PreCompact` or `PostCompact` in `settings.json`), they may not run when the plugin compacts.
- In our everyday sessions on 2 and 3 November 2026 (test sessions not counted), 14 of 17 auto-compactions used the plugin's summary. In the other 3, the summary was not ready yet.
- If the plugin was installed or reloaded while a conversation was open, the first message after compaction in that conversation has no path to the session file. A conversation started after installing does not have this problem.
- Not yet verified: whether Claude needs to load on-demand tools again after compaction, whether skills are carried in full after you resume a conversation, and whether the plugin takes part in idle compaction. If something seems missing after compaction, ask Claude to load it again.

## Update, disable or remove

Updates are manual: Claude Code does not update plugins from this marketplace by itself. `claude plugin list` shows your version.

### In a terminal

Update:

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

Open conversations load the change after `/reload-plugins` or a restart.

### In the VS Code extension

Type `/plugins`. On the **Plugins** tab, next to live-compact: the switch turns it off, the update icon ("Update plugin to the latest version") updates it, and the trash icon uninstalls it. To remove the marketplace too, click the trash icon next to `socialbuzzstudio` on the **Marketplaces** tab; the confirmation names the plugins that go with it. Changes apply right away.

In both cases: if you set `LIVE_COMPACT_LOG_DIR`, remove it from `settings.json` and delete the log folder yourself.

## Event log

Optional, for troubleshooting. Add `LIVE_COMPACT_LOG_DIR` to the `env` section of `~/.claude/settings.json` (on Windows `%USERPROFILE%\.claude\settings.json`; create the file if it does not exist). If the file already has an `"env"` section, add the line inside it. Replace `you` with your Windows user name; the folder is created automatically.

```json
{ "env": { "LIVE_COMPACT_LOG_DIR": "C:/Users/you/claude-logs" } }
```

New conversations then write one JSON line per event to `<session id>.jsonl`, one file per conversation (the newest file is the current one). The log holds counts, times and reasons, no conversation text. To report a problem, attach the newest file. Without the setting, the plugin writes nothing to disk.

Each line has `t` (time) and `ev` (event):

| `ev` | When |
| --- | --- |
| `fork-start` | The background request started |
| `fork-end` | It ended: its time, the summary length or the failure reason, and token usage |
| `compact` | A compaction: what started it, whether the plugin's summary was used, and how many messages were kept |
| `tick-error` | A check of the context size failed |

## Help and license

If compaction takes minutes again and no `live-compact:` line appears after an auto-compaction, the plugin is not working: turn it off (above) and tell us in [GitHub Issues](https://github.com/SocialBuzzStudio/live-compact/issues). A `background summary failed` line alone is no reason to turn it off. If the plugins window will not open, `"disableAllHooks": true` in `~/.claude/settings.json` turns off all mods and your own hooks. Claude Code may change how mods work in an update; we have not tested what happens to live-compact then.

Not affiliated with Anthropic. MIT license, see [LICENSE](LICENSE).

## Development

```
git clone https://github.com/SocialBuzzStudio/live-compact
cd live-compact
claude plugin test mod
claude plugin validate mod
claude --plugin-dir ./mod
```

`plugin test` runs the tests without model calls; `--plugin-dir` starts Claude Code with the plugin loaded from this folder. `mod/` is the plugin itself (Claude Code calls a plugin with code like this a mod):

- [mod/hooks/register.ts](mod/hooks/register.ts): hooks, checks, background request, event log
- [mod/hooks/compaction.ts](mod/hooks/compaction.ts): the messages kept after compaction
- [mod/hooks/skills.ts](mod/hooks/skills.ts): skills carried over to the first message
- [mod/hooks/summary-prompt.ts](mod/hooks/summary-prompt.ts): the summary prompt and the first message
- [mod/tests/](mod/tests/): tests
- [assets/how-it-works.mmd](assets/how-it-works.mmd): source of the diagram
- [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json): the `socialbuzzstudio` marketplace
