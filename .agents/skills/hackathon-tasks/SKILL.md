---
name: hackathon-tasks
description: "Break a hackathon PRD into tracer-bullet task cards with acceptance criteria, TDD seams, time estimates, owners and blocking edges — sized for parallel work by a small team or agents. Use when a PRD exists and work must be split ('break this into tasks', 'rozpisz taski', 'split the work'). Produces docs/tasks/."
---

# Hackathon Tasks

Turn `docs/PRD.md` into tracer-bullet task cards: vertical slices a single person or agent can complete in one fresh session. Read the PRD first; if it does not exist, route to `hackathon-prd`.

## Process

### 1. Draft vertical slices (tracer bullets)

Each card cuts one narrow but COMPLETE path through every layer — data, API, UI, tests — so a finished card is demoable on its own. A card that only touches one layer ("build the database schema") is not a card; glue it to the slice it serves.

**Card 01 is always the tracer bullet:** the thinnest end-to-end slice through the whole system — one button in the UI hitting one endpoint returning one row of mock data, deployed. It exists to prove the pipeline works while there is still time to fix it. Everything else hangs off it.

Rules:

- Each card fits in one fresh context window (roughly: one sitting, 1-3 realistic hours).
- Each card's acceptance criteria are its definition of done — written so an agent grabbing the card cold can verify them without asking questions.
- No file paths or code snippets in cards; they go stale. Describe behaviour.

### 2. Add blocking edges and time estimates

- **Blocked by:** which cards must complete first. The **frontier** is every card whose blockers are done — that is what gets worked on now, in parallel across people/agents.
- **Estimates:** optimistic and realistic, where realistic = optimistic × 2 (interruptions, demo practice, food). Show the sum.
- **Owners:** a person, a person+agent pair, or `agent` for self-contained cards.

### 3. Fit the budget

Sum the realistic estimates of Must-scope cards. If it exceeds ~75% of remaining hackathon time, do not silently hope — move cards to Stretch or cut them, and update the PRD's scope section to match. Say what was cut and why.

### 4. Quiz the team (one round)

Present the breakdown as a numbered list: title, blocked-by, what it delivers, estimates. Ask: is the granularity right? Are the edges correct? Any card to merge/split? Iterate once or twice, then write.

### 5. Write one file per card to `docs/tasks/`

`NN-slug.md`, numbered in dependency order (blockers first):

```markdown
# NN: <title>

**What to build:** the end-to-end behaviour this card makes work, from the user's perspective

**Blocked by:** <card numbers/titles, or "None — can start now">

**Estimate:** <optimistic> / <realistic ×2>

**Owner:** <person / person+agent / agent>

**TDD:** seam(s) to test at — write the failing test first, then minimal code to pass (see the `tdd` skill)

**Demo check:** the exact command or click path that shows it working

**Status:** ready

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

Mark each card's Status `done` only when every checkbox is ticked and its demo check passes.

### 6. Working the cards

- One card = one fresh session, grounded in `AGENTS.md` + the card file. Do not carry old session context into a new card.
- Cards touching the UI get a `browser-use:web-gui-tester` pass over their demo check before being called done.
- After finishing a slice, run `code-review` on the diff before merging it into the demo path.
- A person handing off mid-card runs the `handoff` skill first.
