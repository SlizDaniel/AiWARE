---
name: hackathon-idea
description: "Turn a freshly revealed hackathon challenge into one validated, differentiated project concept. Use when the challenge/theme was just announced, the team is brainstorming what to build, or the user asks 'what should we build' / 'co budujemy' for a hackathon. Produces docs/CONCEPT.md."
---

# Hackathon Idea

Go from a raw challenge statement to one chosen concept the whole team believes in — fast, but not recklessly. This phase costs 10% of the hackathon and determines the other 90%.

## Process

### 1. Ingest the challenge

Get the challenge from the user (pasted text, file path, or URL). Fetch/read it yourself — finding facts is your job, never the user's. Extract:

- Theme and tracks (and which prize track we're aiming at)
- **Judging criteria with weights** — these decide what "best" means
- Constraints: team size, allowed tech, required APIs/sponsors, submission format
- Timeline: total duration, checkpoint/pitch times

If judging criteria are not published, infer them from the prize description and say so.

### 2. Generate 3-5 candidate concepts — deliberately spread

Generate candidates in these deliberate categories, not a homogeneous list:

1. **The obvious interpretation** — what 60% of teams will build. Name it explicitly so the team knows what it is beating (or avoiding).
2. **The lateral twist** — same underlying problem, but an unexpected mechanism, audience, or channel.
3. **The distribution play** — the problem solved where it already lives (a plugin/embed for an ecosystem: Slack, GitHub, browsers, shop platforms) instead of a standalone app.
4. **The wildcard** — high wow-factor, higher risk. Only if the team explicitly wants it.

For each candidate, one line each: the one-liner, the magic moment (THE moment a judge sees and remembers), and who feels this pain today.

### 3. Score ruthlessly

For each candidate, answer:

- **Hair on fire?** Is the problem painful enough that someone would use this on Monday?
- **Demoable?** Can the happy path be built in the remaining time with a boring, proven stack?
- **Why now?** What changed recently that makes this possible/inevitable (judges ask this)?
- **Why us?** What does this team have that makes us the ones to build it?
- **Differentiation:** if we cannot say in one sentence why this doesn't already exist AND why we can build it in a weekend — pick something else. Novelty belongs to the concept; the technology stays boring.

Eliminate any candidate failing two or more of these.

### 4. Grill the team

Run one or two rounds of the `grilling` skill format (design tree, numbered questions, recommended answer under each) over the survivors: audience, core loop, magic moment, biggest risk. Keep each round under 6 questions — this is a hackathon, not a procurement.

### 5. Write `docs/CONCEPT.md`

```markdown
# Concept — <working name>
One-liner: <what it is, in one sentence a judge could repeat>

## Problem
2-3 sentences. Real, painful, from the target user's perspective.

## Magic moment
The single moment in the demo judges will remember.

## Demo in one sentence
"<User> does X, and Y happens."  (This becomes the happy path.)

## Why now
## Why us (team assets)
## Track & judging fit
Which track/prize, and how it scores against each published criterion.

## Risks & fallbacks
Top 3 risks. Each with a mitigation — usually "mock it" or "pre-recorded fallback".

## Deliberately NOT building
```

### Sanity check before finishing

Ask aloud: could this demo fail live? If yes, the concept must include a fallback (screenshots/video recorded earlier, mock data instead of live services). A concept without a demo-failure plan is not done.

Then route: `hackathon-prd` is next.
