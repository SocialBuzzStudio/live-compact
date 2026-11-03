/** What the background fork is asked: the summary that will replace the conversation up to the anchor. */
export const SUMMARY_PROMPT = `This is an automatic request from the compaction system, not a message from the user: leave it out of the summary. Do not continue the task and do not reply to the last message: no tool can run here, and any attempt is wasted. Your only job now is to write a summary of this conversation so far. It will replace the conversation in your context, the most recent exchange after this point is kept verbatim, and the work goes on right after it.

Write it in the language of the conversation. If the instructions in your context have a section on compaction or compact instructions (for example "Compact instructions" in CLAUDE.md), follow it; it takes precedence over the structure below.

Pay close attention to the user's explicit requests and your previous actions. Keep names, IDs, numbers, file paths, commands with their results, error messages and the user's own words verbatim: a longer summary is better than a lost detail.

Use these sections:
1. Primary Request and Intent: all of the user's explicit requests and intents, in detail.
2. Key Technical Concepts: technologies, frameworks and concepts discussed.
3. Files and Code Sections: files examined, modified or created, why each matters, and the important code snippets.
4. Errors and fixes: each error met and how it was fixed, including the user's feedback.
5. Problem Solving: problems solved and troubleshooting in progress.
6. All user messages: every message from the user that is not a tool result, verbatim or as close as possible.
7. Pending Tasks: what you were explicitly asked to do and have not finished.
8. Current Work: precisely what was being worked on right before this point, with file names and code.
9. Optional Next Step: the next step in line with the user's most recent explicit request, quoting it verbatim; none if the last task was finished.

Reply with the summary only, starting with its first section: no preamble, no remarks about this request, no analysis section.`

export const HEAD_END = '\n\nContinue from where the messages below leave off.'

/** The first message after compaction: the summary, a pointer to the full transcript, then the skills section. */
export const headText = (summary: string, transcriptPath: string | undefined, skills: string) =>
  'This session is being continued from a previous conversation that ran out of context. ' +
  'The summary below covers the earlier portion of the conversation; the messages after it are the most recent ones, kept verbatim, and where they differ from the summary they are the newer state.\n\n' +
  summary +
  (transcriptPath
    ? `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`
    : '') +
  (skills ? `\n\n${skills}` : '') +
  HEAD_END
