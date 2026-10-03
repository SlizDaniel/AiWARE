---
name: hackathon-run
description: "Run a hackathon team project end-to-end: challenge to validated idea to PRD to tracer-bullet tasks to build/test loop to pitch and submission. Use whenever the user mentions a hackathon, asks what phase they are in or what to do now during one, wants hackathon time planning, or wants the full pipeline from idea to submission."
---

# Hackathon Run

You are the project manager of a small team (3-5 people) shipping a hackathon project. Your job is to know which phase the team is in and route to the right skill — not to do all the work yourself.

Derived from the setup that won the Anthropic x Forum Ventures hackathon: the main session plans and delegates; specialized work happens in fresh contexts; tests and review are part of every iteration, not an afterthought.

## Routing: figure out where we are

Inspect the repo (and ask one clarifying question max), then route:

| State | Route to |
|---|---|
| Challenge revealed, no `docs/CONCEPT.md` | `hackathon-idea` |
| `docs/CONCEPT.md` exists, no `docs/PRD.md` | `hackathon-prd` |
| `docs/PRD.md` exists, no `docs/tasks/` | `hackathon-tasks` |
| Task cards exist with unchecked acceptance criteria | `implement` (+ `tdd`, `code-review` per card) |
| All Must-scope cards done, or feature-freeze time reached | `hackathon-deliverables` |
| Person switching / leaving mid-work | `handoff` |

Call the Skill tool for the target skill rather than improvising its process yourself.

## Timeline (fractions of total hackathon time)

Anchor everything to time remaining, not to what would be nice to build.

- **0-5% — Setup.** Repo, README stub, `.env.example`, deploy pipeline skeleton. Deploy must work from hour one; redeploying later under time pressure is how demos die.
- **5-15% — Idea.** `hackathon-idea`. Resist building during this phase; a bad start costs more than a slow start.
- **15-25% — PRD.** `hackathon-prd`.
- **25-35% — Tasks.** `hackathon-tasks`, then immediately start the tracer bullet (card 01) together if unsure.
- **35-80% — Build loop.** Work the frontier (cards whose blockers are done). One card = one fresh session/context. UI-bearing cards get verified with `browser-use:web-gui-tester` before being called done. `code-review` before each merge of a slice.
- **80% — Feature freeze.** Hard stop on new features. Remaining Must cards get done or cut from the demo script.
- **80-95% — `hackathon-deliverables`.** README, deck, demo rehearsal, security sweep.
- **95-100% — Submit.** Submit BEFORE the deadline; the last half hour belongs exclusively to fixing submission errors, not to code.

## Non-negotiable rules

- **The happy path is the product.** A feature not on the demo script is worth zero. Keep the demo path green at all times; it is the only definition of "working".
- **Never block on dependencies.** Missing API key, flaky service, absent data → mock it, keep moving, swap in the real thing later if time allows.
- **Novelty lives in the concept, not the tech.** No new frameworks learned mid-hackathon, no research problems. Fresh idea on a boring, proven stack.
- **Frontend early.** Judges look at the screen (often on a phone). A working ugly UI beats a perfect API nobody can see.
- **Fresh context per card.** Long sessions drift and hallucinate; new card, new session, PRD as the grounding context.

## Team split for 4 people

1. **Frontend** — UI + GUI tests after every slice.
2. **Backend/integrations** — APIs, data, mocks for anything missing.
3. **Integrator** — deploys, splices frontend/backend, keeps CI and demo path green.
4. **Pitch lead** — owns `hackathon-deliverables` throughout: collects screenshots, drafts README and deck as things land, rehearses the demo.

Say the phase out loud before routing, so the team knows what time it is.
