---
name: FinAssist
description: A student's pay period laid out as a runway of days, in graphite and brushed platinum.
colors:
  ground: "#09090b"
  graphite: "#121215"
  graphite-raised: "#19191d"
  plat: "#d9d9de"
  plat-ink: "#111113"
  plat-track: "rgba(217, 217, 222, 0.12)"
  foreground: "#f2f2f0"
  figure-white: "#ffffff"
  text-bright: "#f4f4f5"
  text-body: "#e4e4e7"
  text-secondary: "#d4d4d8"
  text-muted: "#9f9fa9"
  text-faint: "#71717b"
  text-missing: "#52525c"
  wash: "rgba(255, 255, 255, 0.05)"
  rail-active: "rgba(255, 255, 255, 0.09)"
  hairline: "rgba(255, 255, 255, 0.07)"
  edge: "rgba(255, 255, 255, 0.1)"
  field-well: "rgba(0, 0, 0, 0.4)"
  chart-grid: "#232327"
  chart-baseline: "#3a3a40"
  titanium: "#1d1d20"
  platinum-chip: "#d4d4d2"
  platinum-chip-ink: "#2a2a2e"
  engraved: "#e8e8eb"
  state-good: "#00d492"
  state-income: "#00bc7d"
  state-warn: "#ffb900"
  state-warn-icon: "#ffd230"
  state-warn-text: "#fee685"
  state-bad: "#ff6467"
  state-bad-text: "#ffa2a2"
  category-other: "#71717a"
typography:
  display:
    fontFamily: "Taka Sign, Archivo, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(4rem, 11vw, 7.5rem)"
    fontWeight: 200
    lineHeight: 1.2
    letterSpacing: "-0.012em"
    fontVariation: "\"wdth\" 122"
  score:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "4.25rem"
    fontWeight: 200
    lineHeight: 1.2
    letterSpacing: "-0.012em"
    fontVariation: "\"wdth\" 122"
  statement:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 300
    lineHeight: "2.5rem"
    fontVariation: "\"wdth\" 112"
  wallet-figure:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 8vw, 2.6rem)"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 118"
  headline:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 300
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 112"
  readout:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 300
    lineHeight: 1.25
    fontFeature: "\"tnum\""
    fontVariation: "\"wdth\" 112"
  figure-small:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 300
    lineHeight: 1
    fontFeature: "\"tnum\""
    fontVariation: "\"wdth\" 112"
  title:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body-lead:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  body-small:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.18em"
    fontVariation: "\"wdth\" 118"
  label-heading:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.18em"
    fontVariation: "\"wdth\" 118"
  axis:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "\"tnum\""
  micro:
    fontFamily: "Taka Sign, Archivo, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.2
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: "1.75rem"
    letterSpacing: "0.3em"
rounded:
  swatch: "3px"
  bar: "4px"
  sm: "8px"
  md: "12px"
  chip: "14px"
  lg: "16px"
  plate: "22px"
  card: "24px"
  sheet: "28px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
  "10": "40px"
  "14": "56px"
components:
  button-primary:
    backgroundColor: "{colors.plat}"
    textColor: "{colors.plat-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.figure-white}"
  button-secondary:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.figure-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-quiet:
    textColor: "{colors.text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  card-link:
    textColor: "{colors.plat}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "44px"
  card:
    backgroundColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "28px"
  card-phone:
    backgroundColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "20px"
  popover:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  segmented:
    backgroundColor: "rgba(255, 255, 255, 0.07)"
    rounded: "{rounded.full}"
    padding: "3px"
  segmented-active:
    backgroundColor: "{colors.plat}"
    textColor: "{colors.plat-ink}"
    rounded: "{rounded.full}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.field-well}"
    textColor: "{colors.figure-white}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  rail-item:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.lg}"
    size: "48px"
  rail-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.figure-white}"
  rail:
    backgroundColor: "{colors.ground}"
    width: "80px"
  tab-bar:
    backgroundColor: "rgba(9, 9, 11, 0.9)"
    typography: "{typography.micro}"
  sheet:
    backgroundColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "20px"
  wallet-card:
    backgroundColor: "{colors.titanium}"
    textColor: "{colors.engraved}"
    rounded: "{rounded.plate}"
    padding: "clamp(18px, 5%, 26px)"
  metal-chip:
    backgroundColor: "{colors.platinum-chip}"
    textColor: "{colors.platinum-chip-ink}"
    rounded: "{rounded.chip}"
    size: "44px"
  meter-track:
    backgroundColor: "{colors.plat-track}"
    rounded: "{rounded.full}"
    height: "8px"
---

# Design System: FinAssist

## Overview

**Creative North Star: "The Timeline"**

FinAssist lays the student's pay period out as a runway of days: the days already spent, today, and every day still ahead at the safe daily amount. The whole world is graphite and brushed platinum. The ground is near-black, surfaces are two steps of graphite, and the only accent is platinum. It marks the action, the bar and the current place. Money is the loudest thing on screen. It is set extra-wide and light at display size, so a balance reads like lettering engraved on a metal card, not like a stat tile.

The world is physical but quiet. There is one brushed-titanium wallet card, a rendered plate under a light that follows the pointer. A few small brushed-platinum chips (the monogram and the phone's Add button) repeat its material. Everything else is flat graphite with a faint top highlight. Motion follows the timeline: bars rise from the baseline left to right, the ring inks in clockwise, figures roll into place like a counter, and the wallet card arrives with one sweep of light. Colour other than platinum carries meaning only. Amber, green and red say state, and always come with an icon and words. Users choose category colours, and those colours appear only where categories are shown.

The world is dark only. There is no light theme.

**Key Characteristics:**
- Graphite ground and surfaces, platinum as the one UI accent.
- Archivo throughout, using its width axis: extra-wide light for money, wide spaced capitals for labels, regular for reading.
- One brushed-titanium wallet card and small brushed-platinum chips. These are real rendered textures, not gradients.
- Thin platinum bars on platinum-tinted tracks, and a scrubbable day-by-day chart as the signature.
- Depth comes from tone and one inset highlight. There are no glows.
- State is shown in words with an icon, never by colour alone.

## Colors

The palette is a cool graphite ramp with one platinum accent. State colours and the user's own category colours are held back for meaning only.

### Primary
- **Platinum** (`plat`): the one accent. It fills primary pill buttons, the active segmented option and the active tile in the phone menu. It colours spent bars, meter fills, card links, the active rail mark (a 1px line), the selection highlight and the focus ring. Its 12–15% tint (`plat-track`) is the track under every bar. Days ahead in the chart are platinum at 13% (32% when scrubbed).
- **Platinum Ink** (`plat-ink`): text and icons on platinum.

### Neutral
- **Ground** (`ground`): the page and the desktop rail. It is also the browser theme colour.
- **Graphite** (`graphite`): every card, the chart panel, sheets and the phone menu.
- **Raised Graphite** (`graphite-raised`): things that float above a card, such as rail labels, the security popover and the skip link.
- **Figure White** (`figure-white`): headings, money, item names, and the hover state of platinum buttons.
- **Text ramp:** `text-bright` (rail labels, the current chart marks), `text-body` (default text in the shell), `text-secondary` (sentences, card headings, units), `text-muted` (dates, notes, inactive nav, axis numbers), `text-faint` (the weight line on health factors), `text-missing` (the dash shown when a figure failed to load).
- **Washes and edges:** `wash` (skeletons, hover fills, secondary buttons), `rail-active` (the current rail item), `hairline` (row dividers and the tab bar's top edge), `edge` (input, sheet and secondary-button borders), `field-well` (the recessed input fill).
- **Chart lines:** `chart-grid` for the half and full scale lines, `chart-baseline` for the baseline.

### Materials
- **Titanium** (`titanium`): the colour under the wallet card's texture (`/textures/brushed-titanium.webp`). Its lettering is `engraved`, with secondary lettering stepping down through a few lighter greys on the plate.
- **Platinum Chip** (`platinum-chip`, ink `platinum-chip-ink`): the colour under `/textures/brushed-platinum.webp`, used for the FA monogram and the phone's raised Add button.
- Both textures come from `scripts/render-metal.py`. Re-render them there. Don't stand in a CSS gradient.

### State (meaning only)
- **Good** (`state-good`): check and shield icons for "On pace", "Signed", "Encrypted · signed", and done steps.
- **Income** (`state-income`): the triangle marking an income day under the chart, named "Income" in the key.
- **Warn** (`state-warn` for fills, `state-warn-icon` for icons, `state-warn-text` for words): ahead of pace, today over its amount, a weak health factor, a failed signature check, figures that couldn't refresh.
- **Bad** (`state-bad`, `state-bad-text` for words): over a budget's limit, a wallet below zero, errors, and the Sign out hover.

### Data colours
- Category colours come from the API and belong to the user. They appear only where a category is named: the spending ring, its legend and the small swatch beside a transaction's category. Past six slices, the rest fold into "Other" (`category-other`).

### Named Rules
**The One Accent Rule.** Platinum is the only UI accent. Actions, progress and position are platinum. No other hue may mark an action, a link or the current page.

**The State Has Words Rule.** Amber, green and red appear only as state. Each use carries an icon and a phrase ("Ahead of pace", "Over by ৳200", "Failed check"). Colour alone never tells the story.

**The Data Colour Rule.** A category's colour follows the category, never its rank. It appears only where that category is shown, and never on UI chrome.

## Typography

**Display Font:** Archivo (variable, with its `wdth` axis), with system-ui, -apple-system, Segoe UI, Roboto, sans-serif
**Body Font:** Archivo
**Label/Mono Font:** Archivo wide capitals for labels. Geist Mono only for one-time and recovery codes.
**Taka Sign:** Archivo has no ৳, so a self-hosted face, "Taka Sign" (`public/fonts/taka-sign.woff`, unicode-range U+09F3), carries only that glyph. It is cut from Noto Sans Bengali (SIL OFL, `public/fonts/taka-sign-OFL.txt`) with its weight axis kept, so ৳ follows the surrounding weight. It is set at 90% size-adjust so it stands level with Archivo's digits. It leads the body font stack.

**Character:** One family does all the work by changing width and weight. Money is extra-wide and light, like engraving. Labels are wide spaced capitals, like the lettering on a card. Reading text is regular width.

### Hierarchy
- **Display** (200, clamp(4rem, 11vw, 7.5rem), wdth 122%, −0.012em): the safe-to-spend figure, with "a day" beside it at 20px in `text-secondary`. Digits are proportional at this size. A figure that failed to load shows the dash at 4.5rem.
- **Score** (200, 4.25rem, wdth 122%): the health score.
- **Statement** (300, 1.875rem on phones and 2.25rem from 768px, wdth 112%): the hero's words when there is no figure ("Nothing left to spend", "Add your income first").
- **Wallet figure** (300, clamp(1.9rem, 8vw, 2.6rem), wdth 118%, an engraved text-shadow): the balance on the metal card.
- **Headline** (300, 26px on phones and 30px from 768px, wdth 112%): the page greeting, "Hello, name".
- **Readout** (300, 30px, wdth 112%, tabular): the chart readout for the scrubbed day. Its unit sits at 14px, regular width.
- **Figure small** (300, 23–26px, wdth 112%): the total in the middle of the ring (26px) and the day numbers in Recent spending (23px).
- **Title** (600, 1rem): sentence headings such as the month-end card and the quick-add sheet. The get-started headings use 1.125rem, or 1.5rem/1.875rem on a first run.
- **Body lead** (400, 15–17px): the hero sentence (16px, 17px from 768px) and the hero's state paragraphs (15px).
- **Body** (400, 0.875rem): list content, item names (600) and buttons (600).
- **Body small** (400, 13–13.5px): the date line, the today meter, health factor names, card links (600), the ring's percentages.
- **Caption** (400, 12–12.5px): state notes, chart key, readout title, fine print under bars, helper text.
- **Label** (500, 11px, wdth 118%, 0.18em, uppercase; the `label-caps` utility): card headings (at 12px, `label-heading`), "Safe to spend", "Wallet", the "In savings" and "Saved in goals" terms, and right-side qualifiers such as "Day 5 of 30" and "Rule-based".
- **Axis** (500, 11px, tabular): chart scale numbers, day numbers, "Today", "Next income · 1 Dec".
- **Micro** (500, 10.5px): phone tab labels and the wallet card's bottom line (uppercase, 0.16em, wdth 118%). The FA monogram on the card's chip is a 10–11px mark, not reading text.

### Named Rules
**The Wide-and-Light Money Rule.** Money at hero, score and card size is light (200–300) and wide (wdth 112–122%). Bold large figures are not part of this world.

**The Tabular Rows Rule.** Amounts in rows, meters, readouts and axes use tabular figures so they line up. Only the display figures stay proportional.

**The Label-Is-the-Heading Rule.** Wide spaced capitals name the thing they head: a card, a figure, a term. A caps label is never stacked as a kicker above another heading.

## Layout

**Shell.** From 768px, an 80px icon rail is pinned to the left in Ground with a 6% white right edge. It holds the FA monogram, a platinum quick-add tile, the section icons, and Sign out at the bottom. Content starts beside it (`margin-left: 80px`). Below 768px, the rail gives way to a bottom tab bar: Home, Expenses, a raised 52px platinum-chip Add button, Budgets and More. More opens every section as a two-column sheet. The tab bar and the page both clear the safe areas, and the page keeps 6rem of bottom padding so the bar never covers the last row.

**Page.** A centred column capped at 1280px, with 16px side padding on phones, 32px from 768px and 40px from 1024px. Top padding is 20px, or 32px from 768px. The dashboard is one grid with 16px gaps on phones and 24px from 768px. It is one column on phones, two from 768px and twelve from 1024px.

**Dashboard order** (source order is phone order, screen-reader order and Tab order): the header (greeting, date and security badge on the left, Quick add expense on the right from 768px), the hero row, the full-width runway chart, the month-end card when due, then three 4-column cards (Where it went, Budget pace, Goals), then Recent spending (8 columns) beside Health (4). From 1024px, the hero row is a two-column grid: the safe-to-spend block on the left, and the wallet card in a 400px column on the right, with a 56px gap.

**Other pages** follow one pattern, built from `components/dashboard/ui.tsx`: the page header (headline title, a sentence under it, the page's controls on the right), then a hero row with the page's headline figure on the left and its main action card in a 400px column on the right (56px gap from 1024px), then a twelve-column grid of cards whose rows end level (8 + 4, 7 + 5, 4 + 4 + 4, or three equal cards). Budgets leads with what is left to spend this month and the New budget card; Savings leads with the savings balance and the Move money card.

**Rhythm.** Card padding is 20px on phones and 28px from 768px. A card heading row is at least 44px tall with 20px below it. Stacked list items in cards sit 24px apart. Notes sit 8–12px under what they explain. Spacing counts in 4px steps.

**Breakpoints:** 640px (sheets become centred 512px dialogs), 768px (rail and multi-column grid), 1024px (twelve columns, two-column hero). The chart also tightens below 560px of its own width, with a shorter plot and fewer day labels.

## Elevation & Depth

Depth is tonal. Ground, Graphite and Raised Graphite are the three steps. Each card carries a single 1px inset highlight on its top edge, as if light caught it. Resting cards cast no drop shadow and nothing glows. Real shadows belong to two kinds of thing: the metal objects, which sit on the page like physical objects, and layers that float over other content.

### Shadow Vocabulary
- **Card highlight** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04)`): every graphite card and the chart panel.
- **Plate drop** (`box-shadow: 0 40px 60px -30px rgb(0 0 0 / 0.95)`): the titanium wallet card.
- **Chip drop** (`box-shadow: 0 10px 22px -10px rgb(0 0 0 / 0.9)`): brushed-platinum chips.
- **Rail label** (`box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08), 0 12px 24px -12px rgb(0 0 0 / 0.8)`): the name tag beside a rail icon.
- **Popover** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5)`): the security explanation.

### Named Rules
**The Tone, Not Glow Rule.** Surfaces separate by graphite step and the top highlight. Coloured glows, blurred light behind elements, and drop shadows on resting cards are not part of this world.

**The One Plate Rule.** A screen has at most one titanium plate: the wallet card on the dashboard, or the static showcase plate beside the sign-in, register and reset forms (from 1024px). Brushed platinum appears only as small chips (a monogram, a single action).

## Shapes

Corners are soft but tighter than a lounge. Cards and sheets use 24px (the phone menu sheet 28px on top). The wallet card is a 1.586:1 plate with 22px corners. Rail tiles use 16px, and the monogram chip 14px. Inputs, secondary and quiet buttons, and choice rows use 12px. Card links and small hover targets use 8px. Primary buttons, segmented controls, meters and status dots are fully round. Chart bars have 4px rounded tops on a square baseline. The chart key's swatches are 3px squares, and income is a small triangle. The spending ring is a thin 10px stroke (16px on hover) with 3px gaps between slices. Borders are rare: 10% white on fields and sheets, 7% white hairlines between rows, and 40% platinum to mark a suggested choice or the current step.

## Components

**Precise and calm.** Controls are compact pills and tiles with at least a 44px target. Feedback is a step to white, a small press and a platinum ring.

### Buttons
- **Shape:** fully round pills for primary actions (9999px). Secondary and quiet buttons use 12px.
- **Primary:** a Platinum fill with Platinum Ink 14px semibold text, at least 44px tall with 20px side padding (48px tall and full width in the quick-add sheet). Used for Quick add expense, Add income, Add expense, Got it, and the current get-started step.
- **Hover / Focus:** the fill steps to white. The header button presses to 97%. Focus is the shared ring: 2px Platinum outline, 2px offset.
- **Secondary:** a 5% white fill with a 10% white border and white 14px medium text. Hover goes to 10% white.
- **Quiet:** `text-muted` text, a 5% white wash on hover ("Later", "Hide", "Skip for now").
- **Disabled:** 40–50% opacity and a not-allowed cursor.

- **Utilities:** `btn-primary`, `btn-secondary`, `btn-quiet`, `btn-danger` (a 15% red fill with a 30% red edge, for the second step of a delete) and `btn-icon` (a 44px square for one icon) in `globals.css`. Width and spacing stay with the caller.

### Chips and Segmented Controls
- **Segmented:** a round 7% white tray with 3px padding. Options are 36px pills in 12px semibold. The selected option is a Platinum fill with Platinum Ink; the rest are `text-muted`, lightening on hover.
- **Metal chip:** brushed platinum over its texture, carrying the FA monogram (rail, wallet card) or the phone's Add plus.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** Graphite.
- **Shadow Strategy:** the card highlight only (see Elevation & Depth).
- **Border:** none. The full get-started panel on a first run adds an 8% white edge.
- **Internal Padding:** 20px on phones, 28px from 768px (the month-end card 24px).
- **Header:** a wide-caps heading in `text-secondary` on the left, and on the right a card link (Platinum 13px semibold with a chevron, white with a wash on hover), a segmented control or a caps qualifier.

### Inputs / Fields
- **Style:** a `field-well` fill with a 10% white border, 12px corners, 12px by 16px padding and white 16px text. The placeholder is `text-muted`.
- **Focus:** the border goes to 50% Platinum, plus the shared focus ring.
- **Error:** a 12px `state-bad` line under the field, announced as an alert. The field is marked invalid.
- **Codes:** one-time and recovery codes use Geist Mono with 0.3em tracking.
- **Utility and labels:** the `field` utility styles inputs, selects and text areas (48px tall). Labels sit 8px above in 13px medium `text-secondary` (`FieldLabel`); errors use `FieldError`. The browser's own controls (date pickers, select menus, scrollbars) are dark through `color-scheme: dark`, and the caret is Platinum.

### Page Header and Hero Figure
- **Page header:** the page title in the Headline style, a 13.5px `text-muted` sentence under it, and the page's own controls on the right (a month stepper, a period toggle, the main action).
- **Hero figure:** a page's headline amount. A caps label over the figure, extra-wide and light at clamp(3.25rem, 9vw, 5.5rem), rolling into place, with a sentence, a meter or terms under it. One per page. It is smaller than the dashboard's safe-to-spend figure, which stays the largest number in the app.
- **Terms:** supporting figures as a `<dl>`: a caps label over a 22–26px light, wide, tabular amount ("In your wallet", "This month").

### Notice and Empty
- **Notice:** a sentence that needs attention, in its state's 10% tint with a 20% edge, led by its icon, with an optional action on the right ("See the plan").
- **Empty:** a 48px wash tile with the icon, a 600 white sentence, a quieter line and the one action that fills the space. No dashed boxes.

### Navigation
- **Rail (768px and up):** 48px tiles with 16px corners and 20px icons. Inactive tiles are `text-muted` at a 1.75 stroke, turning white with a 5% wash on hover. The current page gets a 9% white tile, a white icon at a 2.25 stroke, and a 1px Platinum line on the rail's left edge. Each tile's name appears beside it on hover and keyboard focus as a Raised Graphite tag. Sign out turns `state-bad-text` with a 10% red wash on hover.
- **Tab bar (phones):** 90% Ground with a strong blur and a hairline top edge. Five 48px-tall cells hold a 21px icon over a 10.5px label. The active cell is white; the rest are `text-muted`. The raised Add chip sits 24px above the bar.
- **More sheet:** a Graphite sheet rising from the bottom with 28px top corners and a "Menu" caps label. It shows a two-column grid of 56px tiles in 16px corners. The current section is a Platinum tile; the rest are 4% white. It is a real dialog: focus moves in, Tab stays inside, Esc closes it.

### Runway Chart (signature)
The pay period as one row of days on a Graphite panel. Its heading names the stretch ("November, day by day"), with a key underneath (Spent, You can spend, Income). Spent days are Platinum bars with 4px tops. Today is an outlined bar at the daily amount (8% Platinum fill, 1.5px Platinum stroke), and turns into a Warn bar once spending passes the amount. Days ahead stand faintly at the daily amount. A past day with nothing spent is a 2px `zinc-700` stub. A bar taller than the scale is cut with a Graphite slash and labelled with its amount. Income days get a small `state-income` triangle under the baseline. A 45% white cursor line follows the selected day, and that day's bar turns white. Pointer, touch drag and arrow, Home and End keys move it (it is a slider). The readout at the top right rolls in for each day with a 0.22s rise, showing the date, the amount in the readout style, and what was spent. An `sr-only` table gives every day as text.

### Wallet Card (signature)
The brushed-titanium plate at a 1.586:1 ratio. It carries FINASSIST in wide caps, the FA chip, the "Wallet" label, the balance in the wallet-figure style, an engraved 60% white trace of each day's closing balance, and Savings and the owner's name along the bottom. On arrival it lifts in from 28px with a 16° tilt (1s), and its light sweeps across once (`metal-arrive`, 1.6s). Under a mouse it leans up to 5°/7° toward the pointer while the light follows. Touch and reduced motion hold it still. The whole card links to Savings.

### Column Chart
`ColumnChart` draws amounts over time (savings by month, income by month) in the Runway's language: thin Platinum columns with 4px tops rising left to right, a compared series in Platinum at 28%, a 3.5% white band behind the column being read, half and full scale lines, and the readout at the top right. Pointer, drag and the arrow keys move it (it is a slider), and an `sr-only` table lists every column.

### Bars, Meters and the Ring
- **Meters:** 6–8px round tracks in `plat-track` with a Platinum fill. Health factor meters are 4px. A fill turns `state-warn` when today is over its amount or a factor is weak, and `state-bad` when a budget is over its limit. Budget meters carry a 2px `text-bright` tick at an even pace through the month. Fills grow from the left on first view (0.9s, staggered 90ms).
- **Spending ring:** 190px wide at most. Slices take the user's category colours, and dim to 25% when another slice is pointed at. The month's total (or the slice being pointed at) sits in the middle in the figure-small style, with the legend below.

### State Note
A 12.5px phrase in `text-secondary` led by a 15px state icon in the tone's colour: check for good, triangle for warn, circle-alert for bad. It is how every status is said.

### Loading, Error and Missing
Skeletons are 5% white blocks in the final content's size and corner, pulsing (still with reduced motion). A figure that failed to load is a `text-missing` dash with "Couldn't load" for screen readers, never a zero. One page notice sits under the header: a 10% red tint for "couldn't load", or 10% amber for stale figures, which names the time they are from. Each has a "Try again" button. Cards far down the page show their own "Couldn't load your …" with a secondary retry button.

### Motion
The default ease is `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo). Bars rise from the baseline left to right (0.7s, staggered 60ms), days ahead and income marks fade in after them, the ring draws clockwise slice by slice (0.8s, staggered 120ms), and figures roll into place digit by digit (1.1s plus 110ms per digit). Sheets rise in a 0.25–0.28s tween. With reduced motion, the rises, the ring draw, the card sweep and the rolling digits stop, while fades and state changes remain. Spinners slow to 2.5s.

## Do's and Don'ts

### Do:
- **Do** keep every screen on Ground with Graphite cards. FinAssist is dark only.
- **Do** use Platinum, and only Platinum, for actions, progress, the current place and focus.
- **Do** set money at hero, score and card size light and wide with Archivo's width axis, and use tabular figures in rows, meters, readouts and axes.
- **Do** head cards with wide spaced capitals (the `label-caps` utility, 12px) in `text-secondary`.
- **Do** say every state with an icon and words, in the State Note pattern.
- **Do** keep category colours on the ring, its legend and category swatches only.
- **Do** separate surfaces by graphite step and the inset top highlight.
- **Do** give every control the shared `focus-ring` and at least a 44px target.
- **Do** show a dash, never a zero, for a figure that failed to load.

### Don't:
- **Don't** introduce a second accent hue, or bring the old amethyst purple, citrine or jewel tones into new work.
- **Don't** use amber, green or red as decoration or without words.
- **Don't** add glows or coloured light behind elements, or drop shadows on resting cards.
- **Don't** put a second titanium plate on a screen, or fake the metal with a CSS gradient. Re-render the textures with `scripts/render-metal.py`.
- **Don't** set large money bold or narrow.
- **Don't** stack a caps label above a heading as a kicker.
- **Don't** set reading text below 10.5px.

## Known drift

Every screen is now in the Timeline world: the dashboard home, the shell, Analytics, Budgets, Income (list, new, edit), Expenses and Transaction history, Goals, Savings, Settings, sign-in, register and forgot password, and the shared CategoryPicker, VerifyCode and NetworkStatus. Recharts is no longer used; amounts over time use `ColumnChart`, and comparisons use meters. Small local pieces that could still move into `ui.tsx`: the code-entry field style (Geist Mono, wide tracking) repeated across the auth screens and Settings, and the static showcase plate in `app/(auth)/layout.tsx`.
