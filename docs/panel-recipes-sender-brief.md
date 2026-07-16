# Brief — "Send to Panel" button (justmy.recipes)

**For:** Claude Code, working in the **justmy.recipes** repo.
**Depends on:** the justmy.website kitchen-panel API, **live in production now** and verified end-to-end.
**Scope:** one button + one server route. Small, self-contained. ~an afternoon.

---

## 1. What this is

justmy.website has a wall-mounted kitchen panel. One of its three screens shows **the active
recipe** — whatever was last "sent to the panel." This brief is the *sender*: a **"Send to Panel"**
button on a justmy.recipes recipe page that pushes that recipe to the panel.

**It is passive.** Sending sets the panel's active recipe; the panel picks it up when Curtis walks
over and taps the Recipe tab. The button does **not** navigate anywhere and the panel does **not**
change under him while he's looking at something else. Success is a quiet confirmation, not a
celebration.

**The receiving endpoint is sender-anonymous.** It takes a JSON-LD Recipe and does not know or care
that justmy.recipes sent it. Do **not** add any justmy.recipes-specific handshake, and do **not**
normalize or reshape the recipe — the panel validates and normalizes on receive. Your job is only to
**forward the recipe's JSON-LD (plus `notes`) with the service token.**

---

## 2. Architecture (non-negotiable)

```
[recipe page button] --POST--> [justmy.recipes OWN server route] --POST(Bearer)--> [justmy.website]
      (browser)                    (holds the service token)              /api/panel/recipe
```

- The button calls **justmy.recipes' own server-side route handler.**
- That route handler holds the **service token** and forwards to justmy.website.
- **The service token must NEVER reach the browser.** No `NEXT_PUBLIC_*`. Not in the client bundle,
  not in a response body, not in the network tab of the page. It lives in server env only.

---

## 3. The live contract (verified in production)

### Endpoint
```
POST https://justmy.website/api/panel/recipe
Authorization: Bearer <service token>          # scope: panel:write:recipe
Content-Type: application/json
```

### Request body
```jsonc
{
  "recipe":   { /* the recipe's JSON-LD Recipe object, PLUS a top-level `notes` field */ },
  "sourceUrl": "https://justmy.recipes/r/<slug>"   // optional but send it
}
```

### Responses
```jsonc
200 → { "ok": true,  "sentAt": "2026-07-16T21:05:00.000Z" }
400 → { "ok": false, "errors": [ "`name` must be a non-empty string.", "…" ] }
401 →   (missing/invalid/wrong-scope token — standard error envelope)
```

**Verified real exchange (production):** sending a Recipe with `HowToStep[]` instructions returned
`200 {ok, sentAt}`; a `{ "@type": "Recipe" }` with no name/content returned `400` with a specific
`errors` array; no token returned `401`.

### Minimum accept criteria (so you can pre-validate / explain failures)
- `recipe["@type"]` is `"Recipe"` **or omitted** (a bare object is accepted; a *wrong* `@type` is rejected).
- `recipe.name` is a non-empty string.
- At least one of `recipe.recipeIngredient` / `recipe.recipeInstructions` is present and non-empty.

Everything else is optional. **Unknown fields are preserved** by the panel (it stores the raw payload
untouched), so **send the full JSON-LD object** — don't strip `image`, `keywords`, `recipeCategory`,
nutrition, times, etc.

---

## 4. ⚠ `notes` is not schema.org and must be included

justmy.recipes has a top-level freeform **`notes`** field (storage life, substitutions, technique
warnings). It is **not** part of schema.org JSON-LD, so a strict JSON-LD-only serializer would drop
it — and it carries real, useful content the panel renders. **The send payload is the recipe's
JSON-LD PLUS `notes`.** If a recipe has no notes, omit the field.

So `body.recipe` = `{ ...theRecipeJsonLd, notes: theRecipe.notes }`.

---

## 5. What the panel does with it (so you don't have to)

For context only — you do **not** implement any of this:
- Validates on receive (returns 400 if malformed) — so a bad payload is caught while the user is
  still on a device with a keyboard.
- Normalizes on receive: flattens `recipeInstructions` (string | string[] | HowToStep[] |
  HowToSection) into flat steps, coerces yield/nutrition, carries `notes`.
- Stores the raw payload unmodified (future fields like `image` ride along) + the normalized view.

Because it normalizes, **send the recipe as-is.** Don't pre-flatten steps or reshape anything.

---

## 6. Implementation

### 6.1 The service token
Curtis minted a device token named **`justmy-recipes`** (scope `panel:write:recipe`) — he has the
raw value. Put it in justmy.recipes' **server** environment, e.g. `JMW_PANEL_SERVICE_TOKEN`
(Vercel env, all environments; **not** `NEXT_PUBLIC_*`). If the value is lost, Curtis re-mints it on
justmy.website with `npm run panel:token -- justmy-recipes`.

### 6.2 The server route (justmy.recipes)
A route handler (e.g. `POST /api/send-to-panel`) that:
1. Authenticates the request as the logged-in owner (however justmy.recipes gates its own routes).
2. Takes a recipe id/slug, loads that recipe, and builds the JSON-LD **+ `notes`** payload (reuse
   whatever already emits the recipe's JSON-LD for the page's `<script type="application/ld+json">`).
3. `fetch`es `POST https://justmy.website/api/panel/recipe` with
   `Authorization: Bearer ${process.env.JMW_PANEL_SERVICE_TOKEN}` and the body from §3.
4. Returns the upstream result to the button: on `200`, `{ ok:true }`; on `400`, pass the `errors`
   array back so the UI can show them; on anything else, a generic failure.

### 6.3 The button
- A "Send to Panel" button on the recipe page.
- On click → calls the server route → shows a **quiet confirmation** ("Sent to panel ✓") or the
  error(s). **Surface the 400 `errors`** — the user has a keyboard; tell them exactly what's wrong.
- **No navigation.** It does not open the panel or redirect. Passive.
- A brief pending state is fine (it's a network round-trip); keep it calm.

---

## 7. Verification checklist

- [ ] Click on a real recipe → quiet "Sent to panel" confirmation.
- [ ] Confirm it landed: on justmy.website open `/panel/recipe` (Clerk-gated in browser) — the recipe
      shows, normalized (steps with headings, notes, ingredients). Or check with Curtis.
- [ ] The **service token is not in the browser**: grep the client bundle / check the network tab —
      the token only appears in the server→server call, never in the page.
- [ ] A recipe deliberately missing `name` (or send `{ "@type":"Recipe" }`) → the button surfaces the
      **400 `errors`**, not a silent failure.
- [ ] `notes` makes it through: send a recipe that has notes → they appear on the panel.

---

## 8. Out of scope / don't do

- **No client-side call to justmy.website.** Always via your own server route (token protection).
- **No normalizing / reshaping** the recipe — send JSON-LD + `notes` as-is; the panel handles the rest.
- **No justmy.recipes-specific coupling** on the wire — the endpoint is sender-anonymous by design.
- **No navigation / no "opening" the panel** — sending is passive.
- **Not** ingredient scaling, images rendering, or anything panel-side — that's all downstream of the
  raw payload you send, handled (or deferred) on justmy.website.
