# Template Token Reference

Templates in Webdata Pro use a simple token syntax. There are two kinds:

- **`${table.field}`** — outputs the value of a field from the current row
- **`$token[args]`** — special-purpose tokens for images, sorting, formatting, etc.

---

## Field values

```
${pets.name}
${pets.dob}
${owners.email}
```

For joined tables, tokens automatically follow the join path defined in the Joins admin screen. You can reference fields from multiple tables in the same view.

---

## System variables

These are injected automatically and available in all templates.

| Variable | Description |
|---|---|
| `${_q}` | Current search query string |
| `${_total}` | Total matching records |
| `${_page}` | Current page number |
| `${_total_pages}` | Total number of pages |
| `${_sort}` | Currently active sort field alias (e.g. `pets__dob`) |
| `${_dir}` | Sort direction: `asc` or `desc` |
| `${_per_page}` | Current page size |
| `${_pagination}` | Rendered pagination widget HTML |
| `${_pk}` | Primary key value of the current row |
| `${_row_num}` | Row number (1-based, within current page) |

---

## Conditional: `$if()`

```
$if(condition, trueValue, falseValue)
```

The `falseValue` is optional.

```html
$if(pets.adopted, "<span class='badge'>Adopted</span>", "<span class='badge'>Available</span>")
$if(pets.price > 100, "Premium")
$if(pets.name, "${pets.name}", "Unknown")
```

**Operators:** `>`, `<`, `>=`, `<=`, `=`, `!=`, `<>`

---

## Sorting: `$order[]` and `$order_url[]`

### `$order[table.field, Label]`

Generates a `<a class="wdp-sort">` link. Automatically appends ↑ or ↓ when active.

```html
$order[pets.dob, Sort by Age]
$order[pets.name, Name]
```

Renders as:
```html
<a href="#" data-wdp-action="sort" data-wdp-field="pets__dob" class="wdp-sort">Sort by Age</a>
```

When that field is the active sort, it becomes:
```html
<a href="#" ... class="wdp-sort wdp-sort-active">Sort by Age ↑</a>
```

### `$order_url[table.field]`

Outputs only the `data-wdp-action` and `data-wdp-field` attributes — no element, no label. Embed directly in any HTML element to make it sortable with your own classes.

```html
<button class="btn btn-sm btn-outline-secondary" $order_url[pets.dob]>
  Sort by Age
  $if(_sort == 'pets__dob', $if(_dir == 'asc', ' ↑', ' ↓'))
</button>

<th style="cursor:pointer;" $order_url[pets.name]>Name</th>

<a href="#" class="wdp-btn-link" $order_url[pets.price]>Price</a>
```

Clicking any of the above will sort by that field, toggling asc/desc on repeat clicks.

---

## Date helpers: `$days_since[]` and `$years_since[]`

```
$days_since[table.field]
$years_since[table.field]
```

- **`$days_since`** — whole days between the field's date and today (rounded down). e.g. `142`
- **`$years_since`** — years to one decimal place. e.g. `3.4`

Works with `date` and `datetime` field types. Returns blank if the field is empty or unparseable.

```html
${pets.name} has been with us for $days_since[pets.intake_date] days.
Age: $years_since[pets.dob] years
```

---

## Images: `$thumbnail[]` and `$img[]`

```
$thumbnail[table.field]
$img[table.field]
```

- **`$thumbnail`** — renders a 100×100px `<img>` with rounded corners. Shows a "No Image" placeholder when empty.
- **`$img`** — renders a full-size `<img>` with `max-width: 100%`.

For gallery tables (multi-photo), `$thumbnail[table.photoField]` shows the first photo.

---

## Photo gallery: `$gallery[]`

```
$gallery[galleryTableName]
```

Renders a drag-reorderable photo gallery widget. The gallery table must be set up via Tables → add gallery table.

```html
$gallery[pets_photos]
```

---

## Aggregates: `$sum[]` and `$avg[]`

```
$sum[table.field]
$avg[table.field]
```

Returns the **sum** or **average** of a numeric field across the **entire filtered result set** — not just the current page.

- The value is the same regardless of which page or row the token appears in.
- Works in all templates: Row, Header, Footer, Group Header, Group Footer.
- Returns blank if no records match or the field is non-numeric.
- An optional second argument sets decimal places (default: 2 for `$avg`, raw for `$sum`).

```
$sum[table.field]         → raw sum, e.g. 97500
$sum[table.field, 2]      → fixed decimals, e.g. 97500.00
$avg[table.field]         → average to 2 decimal places, e.g. 485000.00
$avg[table.field, 0]      → average rounded to whole number, e.g. 485000
```

### Combining with `$currency[]`

Nest `$sum` or `$avg` inside `$currency[]` to get a fully formatted number with thousands separators:

```html
<!-- In Header or Footer -->
We currently have ${_total} properties listed.
The average asking price is $$currency[$avg[properties.price], 0].

Total adoption fees collected: $$currency[$sum[pets.adoption_fee], 2]
Average fee: $$currency[$avg[pets.adoption_fee], 2]
```

The `$avg` (or `$sum`) token resolves first to a plain number, then `$currency[]` formats it. The `$` before `$currency` is a literal dollar sign — just type two `$` in a row.

---

## Currency / number: `$currency[]`

```
$currency[table.field]
$currency[table.field, 2]
```

Formats a number with thousands separators. The optional second argument sets decimal places.

```
$currency[products.price, 2]   → 1,299.00
$currency[reports.total]       → 42,500
```

Also accepts a literal number as its first argument, which is how nesting with `$sum`/`$avg` works (see above).

---

## Sort button (legacy): `$sort[]`

```
$sort[table.field]
$sort[table.field, Label]
```

Generates a `<button>` with a reset style. Prefer `$order[]` or `$order_url[]` for new templates — they offer more styling flexibility.

---

## Per-page selector: `$perpage[]`

```
$perpage[10, 25, 50, 100]
```

Renders a `<select>` that lets the visitor change how many records appear per page.

---

## Advanced search inputs: `$search[]`

Used inside the Search Form template to create per-field filter inputs.

```html
<input type="text" $search[pets.name] class="wdp-input" placeholder="Name">
<input type="text" $search[pets.dob] class="wdp-input" placeholder="DOB">
<select $search[pets.species] class="wdp-input">
  <option value="">Any species</option>
  <option>Dog</option>
  <option>Cat</option>
</select>
```

The field filters support operator prefixes:
- `>=10` — greater than or equal
- `<100` — less than
- `=exact` — exact match
- `10..50` — range

---

## Owner fields: `$owner[]`

When a view has `limit_to_own_records` enabled, `$owner[table.field]` outputs a field from the record owner's profile row in another table.

```html
Listed by: $owner[realtors.name]
$thumbnail[realtors.photo]
```

---

## Portal navigation

```
$portal_header
$portal_footer
```

Inserts the portal navigation bar. Define the header and footer HTML in Views → Portal Nav.

---

## Grouping: `<group>` tag

Groups repeated values in the Row template into a single cell (like a GROUP_CONCAT).

```html
<group delimiter=", ">${pets.tag}</group>
```

Use in conjunction with the Group Header / Group Footer templates and a `Grouping field` set on the view.

---

## Record owner metadata

Available in templates when `_wdpro_metadata` is enabled:

| Token | Description |
|---|---|
| `${_meta__created_at}` | Record creation timestamp |
| `${_meta__updated_at}` | Last-updated timestamp |
| `${_meta__created_by}` | Display name of creating member |

These can also be used as sort fields in the view settings.
