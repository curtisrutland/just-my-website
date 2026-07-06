# ideas for backlog:

- [x] index link in sidebar with other modules
- [x] link to justmy.recipes with that color on sidebar, a more fully branded link on the index page
- [ ] you implemented the design faithfully but the bottom "log>" section should probably not exist as we aren't logging from the site

# feedback from Claude.ai

1. **`set_day_kind` runs but targets don't resolve — likely the actual bug.** Day came back `kind: "rest"` correctly, but `targets: {}` is empty. The skill doc sells the rollup as showing targets ("totals, estimation %, target(s)"). Either the rest target isn't configured server-side, or `get_day` isn't joining/returning it. Breaks the skill's stated value prop — tagging a day is pointless if the target comparison is missing. Highest priority.

2. **`foodName: null` on every entry.** `log_entry` has no name param, so entries are only distinguishable by note + quantity. Rough for later review/correction — you'd scan notes and gram weights instead of names. Either `log_entry` should accept a display name or the client should derive one.

3. **No dependency declared / no error surfaced.** `import httpx` failed with a bare `ModuleNotFoundError` in a fresh sandbox. The skill doesn't pin its deps. A `requirements.txt` or an install note at the top of `client.py` would save a round trip.

4. **No write confirmation from `log_entry`.** Only way to confirm a write is a follow-up `get_day`. If one of a batch silently failed, you'd only catch it on re-read. Writes should return the created object so a caller can verify inline.

5. **Skill doesn't declare required network egress.** Worked only because `justmy.website` was allowlisted, but the skill description doesn't state required domains — unlike `manage-recipes`, which explicitly says it needs egress for `justmy.recipes`. Mirror that so the requirement is discoverable before hitting a wall.