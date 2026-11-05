---
version: 1
slug: "src-app-dashboard-page-tsx"
primary_target: "src/app/dashboard/page.tsx"
related_targets: ["src/app/dashboard/layout.tsx"]
---

## Scope

The dashboard home (`src/app/dashboard/page.tsx`) and the shell every dashboard page shares (`src/app/dashboard/layout.tsx`: desktop icon rail, phone bottom tab bar, quick add). Visitor mode: Operate. Other dashboard pages keep their current content and pick up the new shell and type; restyling their insides is a later round.

Audience and job: a university student in Bangladesh, on a phone as often as a laptop, checking every day what is safe to spend and logging small expenses quickly.

## Direction contract

THESIS: The pay period as a runway the student can drag across: every day already spent, today, and every day still ahead drawn at the safe daily amount. It refuses the category default of a grid of equal stat cards with a glowing accent.

OWN-WORLD: Graphite ground #09090B with surfaces #121215 and #19191D, platinum #D9D9DE as the only accent, one brushed-metal wallet card, Archivo throughout (extra-wide light for money, wide spaced capitals for labels, regular for text), thin platinum bars, amber and green only for state and always with an icon and words.

STORY: The student reads what is safe to spend today and how today compares with it, sees the whole stretch to the next income day by day, sees which budgets are ahead of an even pace and whether goals are reachable, and adds an expense from the rail or the tab bar.

FIRST VIEWPORT: Icon rail on the left (80px) with the FA monogram and a quick-add button; header with "Hello, name", the date and the security badge on the left and Quick add expense on the right; hero row with the safe-to-spend figure (about 112px, extra-wide light) plus the runway sentence and today's meter on the left, the metal wallet card (1.586:1) on the right; the full-width day-by-day chart with its readout directly below. Signature interaction: scrubbing the chart (pointer, touch drag, arrow keys) rolls the readout to that day. Motion grammar: bars rise left to right on load, the wallet card is presented with one sweep of light and tilts under the pointer, figures roll into place; reduced motion keeps fades and state changes only.

FORM: Timeline, picked by the owner from three built concepts (Chronograph, Timeline, Briefing) in the Concept Studio; it was the second of three. seed: none — the concept-seed roll was skipped, not unavailable: the owner chose the direction directly from the built concepts.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
