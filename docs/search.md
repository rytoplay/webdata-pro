# Search Reference

## Global keyword search (`q`)

The main search box searches across all text fields in a view. It supports boolean operators.

### Basic syntax

| Query | Meaning |
|---|---|
| `pool view` | Both words must appear (implicit AND) |
| `"ocean view"` | Exact phrase |
| `pool OR beach` | Either word |
| `!condo` | Exclude word |
| `NOT condo` | Same as `!` |
| `pool AND (view OR beach)` | Grouping with parentheses |

Operators are case-insensitive: `AND`, `and`, `And` all work.

### Precedence

NOT > AND > OR — same as standard boolean logic.

`pool !condo OR beach` is read as `pool AND (NOT condo) OR beach`.

Use parentheses to be explicit: `pool AND (!condo OR beach)`.

---

## Per-field filters (advanced search panel)

When the advanced search panel is visible (click the arrow next to the search box), you can filter individual fields.

### Operators

| Prefix | Meaning | Example |
|---|---|---|
| (none) | Contains / LIKE | `labrador` |
| `=` | Exact match | `=Labrador` |
| `>` | Greater than | `>100` |
| `>=` | Greater than or equal | `>=2020-01-01` |
| `<` | Less than | `<50` |
| `<=` | Less than or equal | `<=99.99` |
| `a..b` | Range (inclusive) | `10..50` or `2020..2023` |

### Boolean in per-field filters

Per-field text inputs also support AND / OR / NOT syntax:

```
labrador OR golden
"german shepherd" OR husky
!poodle
```

### Date ranges

```
2020..2023       — year range
2024-01-01..2024-06-30  — specific date range
>=2020           — from year onwards
```

---

## Fulltext search (MySQL only)

If a field has **Fulltext Index** enabled (Tables → field settings), MySQL will use `MATCH ... AGAINST` in boolean mode instead of `LIKE`. This is faster on large datasets and supports relevance ranking.

Fulltext and LIKE searches are combined — a record matches if either returns a hit.

---

## Search tips for template builders

The `${_q}` variable contains the current search string. Use it to show a "Searching for: X" message or to pre-fill a search input:

```html
$if(_q, "<p>Results for: <strong>${_q}</strong></p>")

<input type="text" name="q" value="${_q}" class="wdp-input">
```
