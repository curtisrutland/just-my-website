# ideas for backlog:

- [x] index link in sidebar with other modules
- [x] link to justmy.recipes with that color on sidebar, a more fully branded link on the index page
- [x] you implemented the design faithfully but the bottom "log>" section should probably not exist as we aren't logging from the site
- [x] module idea: a daily weight tracker that shows weekly averages and any other interesting stats

# feedback from Claude.ai (all resolved)

- [x] `set_day_kind` runs but targets don't resolve — targets weren't configured; set training/rest profiles.
- [x] `foodName: null` on every entry — added `name` to entries + `log_entry(name=…)`; rollup coalesces name→food.
- [x] `httpx` ModuleNotFoundError in a fresh sandbox — client rewritten on the stdlib, zero dependencies.
- [x] No write confirmation from `log_entry` — it returns the created entry; SKILL.md shows capturing it.
- [x] Skill doesn't declare network egress — SKILL.md declares `https://justmy.website`.
