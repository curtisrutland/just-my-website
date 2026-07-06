---
name: manage-shopping
description: >-
  Manage Curtis's shopping list in justmy.website. Use whenever Curtis wants to add things to buy
  ("add the ingredients for tacos", "put oat milk on the list"), asks what's on the list, or wants to
  check items off, edit, or remove them. The web UI is the other write path (Curtis edits it in the
  store); this is your path.
---

# manage-shopping

You keep Curtis's shopping list. It's a **plain working list**, not a database: one grouping level
(a freeform **category** → items), **no quantities as data** (the item text carries it — "2 dozen
eggs"), and **no normalization** (don't dedupe or rename — say what he says). Items are `needed`
until checked off (`bought`); removing is a soft-delete for mistakes.

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import ShoppingClient
s = ShoppingClient()   # base URL + Curtis's agent token are baked in
```

## Adding (the common case)

Category is a freeform label ("Produce", "Frozen", "Household"); put the amount in the words.

```python
s.add_item("Produce", "2 dozen eggs")                       # one item; returns it (check its id)

# Batch — "add the ingredients for X". Group each into a sensible category:
s.add_items([
    ("Produce", "a big thing of spinach"),
    ("Produce", "3 limes"),
    ("Dairy", "block of cheddar"),
    ("Pantry", "black beans"),
])
```

Use categories consistently (they're grouped **case-insensitively**, so "produce" joins "Produce").
Prefer a handful of broad, store-shaped categories over many narrow ones.

## Reading the list

```python
lst = s.get_list()                    # {"active": [...groups...], "recentlyBought": [...], "activeCount": N}
for group in lst["active"]:
    print(group["category"], [i["text"] for i in group["items"]])
```

`active` is grouped by category (alphabetical); each item has an `id`, `text`, `status`. This is how
you find an item's `id` before checking/editing/removing it.

## Checking off / putting back

There's no "check off by name" call — **read the list, find the item, act on its `id`**:

```python
lst = s.get_list()
milk = next(i for g in lst["active"] for i in g["items"] if "milk" in i["text"].lower())
s.check_item(milk["id"])              # needed -> bought (drops into "recently checked")
s.uncheck_item(milk["id"])            # bought -> needed (back on the list)
```

If a name is ambiguous (several matches), ask Curtis which one rather than guessing.

## Editing / removing

```python
s.edit_item(item_id, text="2 dozen eggs")      # fix the wording or category; only supplied fields change
s.delete_item(item_id)                          # soft-delete — for things added by mistake, not for "bought"
```

**Check off vs. delete:** checking off records that it was bought (it shows briefly in "recently
checked" and can be un-checked). Delete is for mistakes. When Curtis says he bought something, **check
it off — don't delete it.**
</content>
