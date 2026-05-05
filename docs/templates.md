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

### Always use the `table.field` form — bare field names do not work

Tokens must include the table name. `${name}` will always render as blank; `${pets.name}` will work.

The reason is that WDP aliases every column in its SQL query as `table__field` (double underscore). The token renderer looks up `data["pets__name"]` when it sees `${pets.name}`, and finds it. If you write `${name}`, it looks for `data["name"]`, which does not exist.

This also applies to `$img[]`, `$thumbnail[]`, `$days_since[]`, `$sum[]`, and any other token that takes a field reference — they all require the `table.field` format.

**Search form input names** are the one exception: form `<input name="...">` elements that filter records should use the `table__field` format (double underscore, no dot) because they are submitted as query parameters, not rendered as output tokens:

```html
<!-- Output token — dot separator -->
${pets.name}

<!-- Search form filter input — double underscore -->
<input name="pets__name" value="${pets.name}">

<!-- Create/edit form field — plain field name only -->
<input name="name">
```

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

## Aggregates: `$sum[]`, `$avg[]`, and `$count[]`

```
$sum[table.field]
$avg[table.field]
$count[table.field]
```

Returns the **sum**, **average**, or **count** of a field across the **entire filtered result set** — not just the current page.

- The value is the same regardless of which page or row the token appears in.
- Works in all templates: Row, Header, Footer, Group Header, Group Footer.
- Returns blank if no records match or the field is non-numeric.
- An optional second argument sets decimal places (default: 2 for `$avg`, raw for `$sum`).

```
$sum[table.field]         → raw sum, e.g. 97500
$sum[table.field, 2]      → fixed decimals, e.g. 97500.00
$avg[table.field]         → average to 2 decimal places, e.g. 485000.00
$avg[table.field, 0]      → average rounded to whole number, e.g. 485000
$count[table.field]       → count of rows where field is non-empty, e.g. 34
```

`$count` is useful for "X of Y records have a photo" summaries — `${_total}` gives the total found, `$count` gives how many have a value in a specific field.

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

## Distance: `$distance[]`

```
$distance[from, to]
```

Computes the distance in miles between two locations using the Haversine formula. Returns a bare number — write the unit in your template.

Each argument can be:
- A **US zip code**: `88201`
- A **quoted address string**: `'107 N Main St, Roswell, NM'`
- A **field reference**: `sightings.zip` or `sightings__zip`
- A **template string** with field interpolation: `'${sightings.city}, ${sightings.state}'`

```html
<!-- Distance from a fixed location to each record's zip field -->
$distance[90210, properties.zip] mi away

<!-- Distance using the record's city and state, interpolated into a geocodable string -->
$distance['${sightings.city}, ${sightings.state}', 88201] mi from Roswell

<!-- Both ends as literals -->
$distance['Phoenix, AZ', 'Albuquerque, NM'] mi
```

### Geocoding

Locations are geocoded on first use and permanently cached in the `_wdpro_geocode` table. Subsequent requests are instant DB lookups.

By default, Webdata Pro uses [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap — free, no API key required). For higher accuracy or international coverage, configure a Google Geocoding API key in **Admin → Settings → Geocoding**.

### US zip codes vs. international postal codes

**US 5-digit zip codes work reliably** — Webdata Pro sends them to Nominatim with a US country filter so `88201` always resolves to Roswell, NM and not a postal code in Bosnia or Germany (both countries also have postal codes in that range).

**Non-US postal codes may be ambiguous** without a Google API key. If you are using postal codes from countries other than the US, configure a Google Geocoding API key in Settings → Geocoding, or use **city + country** format instead:

```
$distance['Berlin, Germany', properties.zip]   ✓ always unambiguous
$distance[10115, properties.zip]               ✗ may match a non-German postal code
```

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

---

## Public forms

Public forms let anonymous visitors submit data without logging in. The table must have **Allow public submissions** enabled in the admin Tables screen.

### `$form[tableName]`

Renders a complete self-contained form — opening tag, all non-PK fields as inputs, and a Submit button.

```
$form[contacts]
```

Additional arguments can be passed as `key=value` pairs after the table name:

- **`field=value`** — any field name from the table sets a hidden pre-filled value the visitor cannot see or change
- **`_redirect=url`** — after a successful submit, the browser navigates to this URL. Without it, a "Record created" message is shown in place.

Parameters starting with `_` are reserved by WDP. All others are treated as hidden field values.

```
$form[contacts, status=Lead, _redirect=/api/v/myapp/contacts-list]
```

Multiple hidden fields are supported:

```
$form[inquiries, pet_id=${pets.id}, source=website, _redirect=/thank-you]
```

### `$formopen[tableName]` / `$formclose`

For custom form layouts. `$formopen` emits only the `<form>` opening tag and any hidden fields you specify. You write your own inputs between it and `$formclose`. The same `field=value` and `_redirect=url` arguments work here too.

```
$formopen[inquiries, pet_id=${pets.id}, _redirect=/thank-you]
<input type="text" name="visitor_name" placeholder="Your name">
<textarea name="message"></textarea>
<button type="submit">Send</button>
$formclose
```

---

## CAPTCHA on public forms

To prevent spam bots, Webdata Pro supports **Google reCAPTCHA v2** on public forms.

### Setup

1. Go to [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) and create a new site
2. Choose **reCAPTCHA v2 — "I'm not a robot" checkbox**
3. Add your domain(s) to the allowed list
4. Copy the **Site key** and **Secret key**
5. In Webdata Pro admin, go to **Settings → CAPTCHA** and paste both keys

### How it works

Once keys are saved, the reCAPTCHA checkbox widget is automatically injected into every `$form[...]` and `$formopen[...]` token render. No template changes required.

- **`$form`** — widget appears above the Submit button
- **`$formopen`** — widget is injected right inside the opening `<form>` tag; you can reposition the `<div class="g-recaptcha">` element in your markup if needed

Submissions without a valid CAPTCHA response are rejected with a 400 before any data is written to the database.

### Disabling CAPTCHA

Clear both the site key and secret key fields in Settings → CAPTCHA and save. The widget will stop appearing in forms immediately.

---

## Advanced SQL mode

Views can be switched to **Advanced SQL** mode in the Templates editor. You write the full `SELECT` statement yourself.

### Column aliasing is required

Token rendering always looks up columns by their `table__field` alias. In automatic mode WDP adds these aliases for you. In Advanced SQL mode **you must alias every column yourself**:

```sql
SELECT
  contacts.id        AS contacts__id,
  contacts.name      AS contacts__name,
  contacts.status    AS contacts__status,
  contacts.age       AS contacts__age
FROM contacts
ORDER BY contacts.name ASC
```

If you omit the alias (e.g. write `contacts.name` without `AS contacts__name`), the token `${contacts.name}` will render blank and `$if(contacts.name, ...)` will always take the false branch.

The primary key column (`contacts__id`) is used internally for detail view links, metadata joins, and `${_pk}`. It must be included and correctly aliased.

### Keyword search with `:q`

Use `:q` as a named placeholder for the visitor's search term. WDP substitutes it with the literal search value before running the query.

```sql
SELECT
  contacts.id    AS contacts__id,
  contacts.name  AS contacts__name
FROM contacts
WHERE (:q = '' OR contacts.name LIKE '%' || :q || '%')
ORDER BY contacts.name ASC
```

- `:q` is the raw search term — add `%` wildcards in your SQL as needed
- When no search is active, `:q` is substituted with an empty string `''`
- The `(:q = '' OR ...)` pattern shows all records when the search box is empty and filters when it has a value
