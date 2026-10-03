---
name: hackathon-prd
description: "Write the master PRD for a hackathon project from the chosen concept: problem, solution, magic moment, demo script, user stories, scope triage, stack, testing seams. Use when the team has picked an idea and needs it written down before building, or the user says 'write the PRD' / 'rozpisz PRD'. Produces docs/PRD.md."
---

# Hackathon PRD

Compress the chosen concept into one master PRD (max 2 pages) that every person and every agent session uses as grounding context. Synthesize what is already known — do not run a long interview. At most ONE round of clarifying questions, in the `grilling` skill format, and only for genuine gaps: stack choice, data sources, who owns what.

Read `docs/CONCEPT.md` first if it exists. If there is no concept yet, route to `hackathon-idea` instead.

## Rules

- The PRD is the single source of truth. One master PRD — never several competing ones. Details of individual features live in task cards, not in more PRDs.
- If the demo script cannot be written concretely, the idea is not ready. Go back to `hackathon-idea`.
- Every user story becomes exactly one task card later. Write them at that granularity.
- Boring stack, aggressive mocking: any dependency that might be missing on demo day (API keys, third-party services, data) gets a mock-data policy from the start.

## Template

Write `docs/PRD.md` following this:

```markdown
# PRD — <working name>
<one-liner>

## Problem
2-3 sentences, from the target user's perspective. Real and painful.

## Solution & Magic Moment
What it does, and THE moment judges remember.

## Demo script (happy path)
1. <numbered user actions — literal clicks/inputs, what the screen shows>
2. ...
Timing: magic moment lands within the first 60 seconds.
Fallback if live demo fails: <pre-recorded video / screenshots / mock mode>

## User stories
1. As an <actor>, I want <feature>, so that <benefit>. [MVP]
2. ... [MVP]
3. ... [STRETCH]

## Scope
- Must (MVP): the happy path works end to end
- Nice-to-have: only after all Must cards are done
- Deliberately NOT building: <features consciously cut>

## Stack & constraints
- Frontend / backend / data / deploy — proven, boring, known by the team
- Mock data policy: <which external dependencies are mocked and where mocks live>
- Deploy target from hour one: <URL/pipeline>

## Testing seams
The 1-2 public boundaries tests live at (per the `tdd` skill).

## Why now / Why us
Pitch ammunition, 2-3 bullets.
```

## After writing

1. Update `AGENTS.md` (create if missing): one paragraph pointing to `docs/PRD.md` as the grounding context, plus the demo path summary. Every fresh agent session starts from this.
2. Read the PRD back against the judging criteria from the concept. If a heavily weighted criterion has nothing in the PRD serving it, flag it to the team now, not after the pitch.

Next: `hackathon-tasks` breaks this into tracer-bullet cards.
