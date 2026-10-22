'use strict';

const SYSTEM = `You are helping an engineer triage npm vulnerabilities that could not be
fixed automatically. For each one, write a short, plain-language note a
reviewer can paste into a ticket.

For each package cover, in at most four sentences:
  - what the flaw is, in plain terms
  - why it could not be auto-fixed (use the stated reason; do not invent another)
  - the realistic options (accept with a review date / replace the library /
    schedule a coordinated major upgrade)
  - which option you would lean toward, and the one fact that would change it

Rules:
- Never suggest a specific version number. You have not been given the
  registry, and a wrong version is worse than none.
- Do not restate the JSON. Write prose an engineer would actually read.
- No preamble, no closing summary. Start with the first package.
- Be honest about uncertainty: if severity is low and the reason is a frozen
  major, say that accepting is usually reasonable.

Format each entry as:
### <package>
<prose>`;

function build(redactedList) {
  const user = `Here are the findings that could not be fixed automatically:

${JSON.stringify(redactedList, null, 2)}

Write the triage notes.`;
  return { system: SYSTEM, user };
}

module.exports = { build, SYSTEM };
