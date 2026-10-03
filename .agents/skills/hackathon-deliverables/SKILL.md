---
name: hackathon-deliverables
description: "Produce the final hackathon package: README, pitch deck, demo script, security sweep and submission checklist. Use during the final phase of a hackathon, at feature freeze, or when the user says 'write the README', 'prepare the pitch deck', 'przygotuj submission', 'we need to submit'."
---

# Hackathon Deliverables

The last 20% of the hackathon. Features are frozen; from here only the happy path, the story, and the submission matter. Say "feature freeze" out loud before starting — no new features, only fixes to the demo path.

Work from `docs/PRD.md` (demo script, magic moment, why now/why us). Read it first.

## 1. Security & hygiene sweep

- `git grep -inE "(api[_-]?key|secret|token|password)\s*[:=]"` — hardcoded credentials go to `.env` (which must be gitignored) before the repo goes public
- Sweep leftover debug output (`console.log`, `print`, commented-out blocks) on the demo path
- `.env.example` present and documented; README quickstart uses it

## 2. Verify the happy path

Run the demo script from the PRD through the `browser-use:web-gui-tester` skill, exactly as a judge would click it. Anything broken: fix it, or cut that step from the demo script. Record a screen capture of the full happy path as the fallback if the live demo fails.

## 3. README

Judges read this first; often it is all they read before the pitch. Write it (in English unless the team says otherwise):

- One-liner + problem/solution, two short paragraphs from the PRD
- The magic moment: a screenshot or GIF right at the top
- Quickstart: clone → copy `.env.example` → install → run (verified commands, not imagined ones)
- Live demo link if deployed
- Stack, one line each on why
- Team + what each person built
- "Built at <hackathon>" + track

## 4. Pitch deck

Invoke the `presentations:pptx` skill with this outline (8-10 slides, Sequoia-style):

1. **Title** — working name + one-liner
2. **Problem** — make it hurt, 1 slide
3. **Solution** — what it does, anchored on the magic moment
4. **Live demo** — a placeholder slide; the demo itself happens in the product
5. **Why now**
6. **How it works** — one high-level slide, no architecture dump
7. **Competition / alternatives** — why existing tools don't solve this
8. **Team**
9. **What's next / the ask**

Ask the team about language (Polish/English) and any required template before generating. Rehearse against judging criteria from `docs/CONCEPT.md`: every heavily weighted criterion needs a moment in the deck or demo.

## 5. Demo script card

One page, minute-by-minute: who speaks, who drives, the exact first 60 seconds (straight to the magic moment, no login tours, no "um, let me just"), the moment to switch to the recorded fallback, and who answers which judge question.

## 6. Submission checklist

- [ ] Repo public, clean, README at top
- [ ] Live demo URL works in an incognito window (fresh session, no cookies)
- [ ] Demo video uploaded and linked
- [ ] Every submission form field filled
- [ ] Judging criteria re-read; each one covered by deck or demo
- [ ] Submitted — before the deadline. The last 30 minutes belong to fixing submission errors only.

If time is short, priority order is: working happy path > submitted on time > README > deck polish > everything else.
