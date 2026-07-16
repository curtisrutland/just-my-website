# Design Brief — JustMy Wall Panel

**For:** Claude Design
**Read first:** `docs/panel-contract.md` — all data shapes come from there.
**Deliverable:** Panel UI for three routes + tab bar, using the existing justmy.website design tokens.

---

## 1. The thing you are designing

A 7" touchscreen bolted to a kitchen wall, running a browser in kiosk mode against
justmy.website. It replaces glancing at a phone for three specific questions:

1. *How much can I still eat today, and is my weight trending the right way?*
2. *What's on the shopping list?*
3. *What am I cooking, and what's the next step?*

That's it. It is not a dashboard for everything. It is not an app. It's an
appliance that answers three questions from across a kitchen.

---

## 2. Constraints — read these before sketching

These are not preferences. They are the physical situation.

**720 × 1280 CSS px, portrait, fixed.** No rotation, no landscape, no responsive
breakpoints. Design for exactly this viewport.

**Viewed from 24–36 inches, standing.** This is the constraint that breaks
intuition. The viewport is phone-shaped and phone-resolution, so it *feels* like
designing for a phone — but a phone is 6 inches from your face. At arm's length,
effective information density is roughly a third of what the pixel count suggests.

Practical translation: **type that looks comically large in your preview is
probably correct.** Body text that would be 16px on a phone wants to be ~24–28px
here. The hero number on the health screen should be readable from across the
room — think 80px+, not 32px.

**Touch only. No hover, no keyboard, no mouse.**
- Every hover state you would normally design does not exist. Do not design one.
- No text input anywhere in the panel. If a design needs typing, it's wrong.
- Touch targets **≥ 60px minimum dimension**. Bigger than standard phone guidance
  (44px), because the user is standing, possibly holding a knife, possibly with wet
  or greasy hands. Assume imprecise taps.
- Generous spacing between targets. A mis-tap that checks off the wrong grocery
  item is annoying; a mis-tap that changes day-type is worse.

**Raspberry Pi 3. 1GB RAM, VideoCore IV GPU.**
- No heavy animation. No parallax, no continuous motion, no blur/backdrop-filter,
  no large box-shadow stacks. These are the specific things that make a Pi 3 stutter.
- Simple transitions (opacity, small transform) are fine. Keep them short.
- Keep the DOM small. A grocery list of 40 items should be 40 simple rows, not 40
  nested card components.
- No web fonts if the token system can avoid it — a system font stack renders
  instantly and the Pi has no font cache warm-up. If the design system's font is
  load-bearing for brand, use it, but know the cost.

**Dark mode, fixed.** No toggle. It's on a wall, and Curtis prefers dark for
everything anyway. Design dark-first, not dark-as-inversion.

**Always on.** This screen is lit for 16 hours a day in a room people live in. It
should be calm. Avoid: pure white, large saturated fills, anything that draws the
eye when you're not asking it to. It should be pleasant to have in peripheral
vision and only become the focus when you look at it deliberately.

---

## 3. Design system

Use the existing justmy.website design tokens. You have them.

**But calibrate, don't copy.** The tokens were sized for phone and desktop
viewing distances. The type scale in particular needs to shift up substantially for
arm's length. Treat the tokens as the palette, spacing rhythm, and radius language
— and treat the type scale as a starting ratio to be re-anchored, not a set of
literal sizes to reuse.

If you find yourself needing a value the tokens don't have, add it as a
panel-scoped token (e.g. `--panel-type-hero`) rather than a one-off. The panel is a
distinct surface with a distinct viewing distance; it's legitimate for it to have
its own scale built on the same system.

---

## 4. Navigation — the tab bar

Fixed bottom tab bar. Always visible on all three routes.

- **Three tabs now:** Health, Shopping, Recipe.
- **Built for five.** Lifting and Riding modules are planned and will become tabs.
  Design the bar so a 4th and 5th tab drop in without a rethink. Beyond five, we
  revisit — do not design a menu or an overflow.
- Bottom placement is deliberate: it's the one reach that's comfortable on a
  wall-mounted panel.
- Icon + label. Labels are not optional at this viewing distance — an icon alone
  is a guessing game from 30 inches.
- Active state must be unambiguous from across the room.
- Tab bar height counts against your 1280px. Budget it.

There is no other navigation. No back, no breadcrumbs, no links off-panel.

---

## 5. Screen: `/panel/health`

> **Post-design note (2026-07-16):** the health screen is designed and settled. The
> **264 lb waypoint / distance-to-goal was dropped** — the weight module tracks trends,
> not goals. The delivered weight card instead shows the 7-day-avg hero, a signed
> `lb/wk` rate, a 30-day sparkline, and the window's range. Contract §5.1 (v1.1) is
> authoritative and reflects this; the "waypoint" mentions below are the original
> brief, kept for history.

**The question:** how much can I still eat, and which way is my weight going?

### Content (from `GET /api/panel/health` — see contract §5.1)

- Macros: consumed / target / remaining for kcal, protein, fat, carb
- Day type: `"training" | "rest" | null` — and this is **tappable** to toggle
- Weight: latest reading, 7-day rolling average, trend direction, distance to the
  264 lb waypoint

### Priority

**Remaining kcal is the hero.** It is the single number he walks up to this panel
to see. Everything else is supporting. It should be legible from across the room
without squinting.

**Protein is the clear second.** He's in a deficit with a 160g protein target —
protein remaining is the number that actually drives what he eats next. Fat and
carb matter but are tertiary; they can be smaller and quieter.

**Weight is a glance, not a study.** The 7-day rolling average and its direction
are the signal. The latest single reading is noise and should be visibly
subordinate — small, secondary, present but not competing. Distance to the 264
waypoint is context, not a call to action.

### Things the design must handle

- **Negative remaining.** He can go over. `-180 kcal` must render legibly and
  should read as informative, not alarming. This is a normal Tuesday, not a
  failure state. Do not design a red panic.
- **Null weight data.** `latest` can be null. `rollingAvg7` can be null (fewer
  than 2 readings in the window). `trend` can be null. Design the empty/partial
  states — they will happen.
- **Day type is null** until it's set for the day. The tap target to set it should
  be discoverable but not nagging.
- **Early in the day, everything is "remaining."** At 7am the hero number is 2300
  and consumed is 0. That's the normal morning state, not an empty state.

### Tone

This is a weight-loss deficit that's been running a while and is working. The
screen should feel like a steady instrument, not a coach. No encouragement, no
streaks, no celebration, no warnings. It reports. He decides.

---

## 6. Screen: `/panel/shopping`

**The question:** what's on the list? — asked while standing in the kitchen.

### Content (from `GET /api/panel/shopping` — see contract §5.2)

Full list. Each item has `id`, `name`, `category`, `checked`. Plus total and
unchecked counts.

### Interaction

**Tap to check** is the panel's one genuinely-better-than-phone interaction. This
is the moment the whole panel justifies itself: he's cooking, he uses the last of
the soymilk, he taps it. Phone is in the other room. Make this feel good.

- The whole row is the target, not a small checkbox. 60px+ tall, full width.
- Immediate optimistic feedback. The Pi is slow and the network round-trip is real
  — the row must respond to the tap instantly, not after the POST resolves.
- Design the failure case: POST fails, row reverts. It should be quiet and obvious,
  not a modal.

### Open design decisions — your call, but decide deliberately

- **Categories.** Items are already categorized (Produce, Dairy, etc.). Group by
  category, or flat list? Grouping helps in a store; a wall panel isn't in a store.
  Consider that this panel's shopping use is *adding to awareness* and *checking
  off during cooking*, not *shopping*. That may argue for flat.
- **Checked items.** Hide, strike through, move to a bottom section, or fade?
  Consider that unchecking a mis-tap needs to be possible, which argues against
  hiding entirely.
- **Long lists.** 40+ items is realistic. Scrolling on a wall panel with a
  greasy finger is not great. Is there a design that reduces scroll — or is scroll
  just fine and I'm overthinking it?

### No adding

There is no "add item" affordance. Adding requires typing; typing on a wall panel
is worse than any alternative. He adds via the skill or the web UI.

---

## 7. Screen: `/panel/recipe`

**The question:** what am I cooking and what's the next step?

### How a recipe gets here

He's on his phone or laptop looking at a recipe on justmy.recipes. He taps "Send
to Panel." That sets it as the panel's active recipe. He walks to the kitchen and
taps the Recipe tab. It's there.

**This is passive.** The panel does not self-navigate when a recipe is sent. It
does not change under him while he's looking at the shopping list. The recipe is
waiting when he goes to look.

**The panel has no recipe browser.** No list, no search, no picker. Selection
happens on the device that's good at selection. The panel is a receiver with
exactly one recipe: the one that was sent. This is the point, not a limitation.

### Content (from `GET /api/panel/recipe` — see contract §5.3, normalized shape §6.4)

```
name          string
description   string | null
recipeYield   string | null      -- "6 bites", "4 servings" — not always numeric
totalTime     string | null      -- ISO 8601 duration, e.g. "PT1H20M" — you format it
ingredients   string[]           -- flat free-text, e.g. "115 g low-fat cottage cheese"
steps         [{ heading: string|null, text: string }]
notes         string | null      -- freeform prose, often long
nutrition     { calories, proteinContent, fatContent, carbohydrateContent } | null
```

### What the real data actually looks like

This was verified against the live API. Design against reality, not against a
tidy imagined recipe.

- **Steps have headings and they're good ones.** Real example headings: "Preheat
  the water bath", "Cook the sausage first", "Grease the jars", "Blend the custard
  base". Use them — they're the scannable layer. But `heading` is nullable; a step
  can be text-only.
- **Step text is long.** Real steps run 200–400 characters and are technique-heavy
  and explanatory, not terse. Example: *"Set your immersion circulator to 172F /
  77.8C and let the water come fully up to temp before anything goes in. Use a pot
  deep enough that the jars can sit with water reaching up to their shoulders. This
  temp is the single most important variable - hotter makes rubbery, squeaky eggs;
  this is the custard window."* You cannot fit that at hero type. This is the
  central typographic problem of the screen.
- **Ingredients are free-text strings with mixed units** — "6 large eggs", "115 g
  low-fat cottage cheese", "1/2 tsp salt", "Butter or oil, for greasing jars". No
  structure to lean on. Some have parenthetical qualifiers ("for the base", "for
  the jars"). Do not design a quantity/unit column layout; it will break.
- **`notes` is long, prose, and genuinely useful.** Real example: *"They keep 5
  days refrigerated and reheat in ~30 sec microwave. To lower fat, use turkey
  sausage and cut the base cheddar."* It is not a footnote to be hidden. But it's
  also not what you need mid-step.
- **Recipe counts are small** — 8 ingredients, 6–8 steps is typical. You are not
  designing for 40-ingredient monsters.

### The actual design problem

Cooking is a **two-phase** activity and the screen has to serve both:

**Phase 1 — mise en place.** He's reading the whole thing: what do I need, how long
will this take, what's the shape of this. Wants: ingredients list, total time,
yield, notes, an overview of the steps.

**Phase 2 — executing.** Hands busy, glancing up from a cutting board at 30 inches.
Wants: *the current step, huge*, and a way to get to the next one without precision.

These want different type scales and different information density. One static
scrolling document serves neither well.

**This is the interesting problem. Solve it.** Some directions, none of them
prescriptive:
- Two modes with a toggle (overview ↔ step-through)
- A step-through that keeps ingredients accessible
- Progressive: full recipe scrolls, but the current step is pinned and enlarged
- Something better

Constraints on whatever you choose: no precision taps, no typing, and advancing a
step should be a large forgiving target. Step check-off / progress is **local state
only** — nobody resumes a recipe tomorrow, so it doesn't survive a reload and
doesn't need to.

### States to design

- **Empty: nothing has ever been sent.** This is a real, normal state — not an
  error. It should explain itself: something like "Send a recipe from
  justmy.recipes." Do not show a recipe list. Do not pick one at random.
- **A recipe is loaded and untouched** (walked up fresh)
- **Mid-cook** (some steps done)
- **Long notes** — a recipe where `notes` runs several sentences
- **Sparse recipe** — no description, no notes, no nutrition, no yield. All
  nullable. Design what it looks like when only name + ingredients + steps exist.

### Not now

- **Images.** `image` may be present in the payload but the viewer ignores it for
  now. Don't design around a hero photo — but if the layout would obviously want
  one later, note where it goes so it's cheap to add.
- **Ingredient scaling.** Neither site does it. Don't design a servings stepper.

---

## 8. Cross-cutting: refresh

Manual refresh is **tap the section header**. Not a dedicated button — a button
eats real estate on a 720px-wide panel for a rare action.

The data auto-refreshes on a poll anyway (~60s), so manual refresh is a fallback
for "I just did something and I want to see it now." Design it as a quiet
affordance, not a prominent control. Some indication that a refresh happened is
worth having; a spinner that blocks the screen is not.

---

## 9. What to deliver

1. **Tab bar** — three tabs, extensible to five, active/inactive states.
2. **`/panel/health`** — full state, plus: negative remaining, null weight, null
   day type, fresh-morning (everything remaining).
3. **`/panel/shopping`** — full list, tap-to-check interaction and its feedback,
   your decisions on grouping and checked-item treatment, plus the empty list.
4. **`/panel/recipe`** — your solution to the two-phase problem, plus: empty
   (nothing sent), loaded, mid-cook, long-notes, sparse.
5. **Panel type scale** — the re-anchored scale, as tokens, with a note on the
   reasoning. This is the piece most likely to be reused when Lifting and Riding
   tabs arrive.

Design against the real data shapes in the contract. If you need a field that isn't
there, that's a contract change — flag it, don't invent it.
