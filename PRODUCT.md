# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Kierownik** — at a laptop in the office: dashboard, stock levels, approval queue, history/audit, settings and user roles. Primary user of the web app.
- **Pracownik magazynu** — on the hall floor, hands often busy; speaks commands („Magu, wzięliśmy paletę kartonów”), glances at the change card and confirms by voice or one tap. On the hall the worker uses the separate Expo mobile app (`mobile/`); at a laptop they use the web app.
- The web app is laptop-first (confirmed 2026-10-04): design for 1280–1920 px wide screens; narrower widths must stay usable but are not the target. The mobile app is out of scope for web design work. The HackYeah jury sees the web app on a projector during the demo.

## Product Purpose

MAGAZYNIER is a voice warehouse agent for small warehouses (2–10 people) that keep stock in a spreadsheet that drifts out of date. The worker says what they did; the agent proposes a change on a card; a human confirms; the change, its author and an undo land in the audit log; the agent proposes reorder drafts when stock drops below the minimum. Success: the spoken sentence replaces the form, and the screen always shows the true state of the warehouse.

## Positioning

An agent that works on the state of a physical warehouse with confirm-before-write: AI interprets speech into tool calls, but nothing is written until a person approves the card, and every write is attributable and undoable. Not a chatbot and not a full WMS.

## Operating Context

- Workflow: voice or text command → change card → confirm/reject (voice „zatwierdź”/„odrzuć” or tap) → audit entry with undo → proactive reorder draft in the approval queue → questions („ile mamy X?”, „gdzie leży X?”, „jak pakujemy X?”) answered with map highlight.
- Onboarding: import of the company spreadsheet (XLSX/CSV) with AI-suggested column mapping; zones named while walking the hall („strefa: kartony”).
- Sections: Mapa, Stany, Kolejka zatwierdzeń, Historia, Procedury, Dashboard kierownika (manager only), Ustawienia.
- Roles: kierownik, pracownik, oczekujący (self-registered, no access until approved).

## Capabilities and Constraints

- Next.js 16 App Router on Vercel; Supabase Postgres + Auth; Google Gemini for command interpretation; browser speech recognition for live dictation with the wake word; Tailwind v4.
- All UI copy is Polish.
- Hands-free listening runs in every section, so the command panel must stay reachable everywhere.
- Charts must not add heavy dependencies; manager dashboard data comes from `/api/dashboard*`.

## Brand Commitments

- Product name **MAGAZYNIER** and the mascot `public/brand/mascot.jpg` stay (confirmed).
- Everything else in the current look (colors, layout, typography) may change (confirmed).

## Evidence on Hand

- Demo data: `public/demo-magazyn.xlsx`, `public/demo-offline.xlsx` (Kartony, Szkło, Folia stretch, Taśma pakowa).
- No customer logos, testimonials or metrics exist; none may be invented.

## Product Principles

1. Confirm before write: the change card is the centre of every interaction and must be unmistakable.
2. Glanceable state: quantities, minimums and pending decisions readable at a glance, from across the office and on a projector.
3. Room to breathe: one task per view; avoid stacking everything on one screen (the user explicitly rejects cramped layouts).
4. A character of its own: must not look like a generic SaaS dashboard template (confirmed).
5. Human in control, visibly: author, time and undo are always one step away.
