# Joins and Relationships

## Defining joins

Joins are defined in the admin panel under **Joins**. Each join connects two tables on a shared field — typically a foreign key relationship.

| Field | Description |
|---|---|
| Left table / field | The table and field on the left side of the join condition |
| Right table / field | The table and field on the right side of the join condition |
| Join type | `left`, `inner`, or `right` — controls how rows are matched in views |
| Label | Optional human-readable name for the relationship |

Example — books and authors connected through a bridge table:

```
books.id  ←→  book_authors.book_id
authors.id ←→  book_authors.author_id
```

You would define two joins:
1. Left: `book_authors.book_id` / Right: `books.id`
2. Left: `book_authors.author_id` / Right: `authors.id`

---

## Displaying joined data in views

Once joins are defined, view templates can reference fields from any joined table using dot notation:

```
$[authors.author_name]
$[authors.bio]
```

The query builder automatically applies the joins needed to resolve these tokens.

---

## Cascade insert — adding joined records from a create form

When a member submits a create form for a parent table (e.g. `books`), Webdata Pro can simultaneously insert a related record into a joined table (e.g. `book_authors`) in a single form submission.

### How it works

Name the input field using the pattern `joinedTableName__fieldName`:

```html
<input type="hidden" name="book_authors__author_id" value="$[authors.id]">
```

On submit:
1. Webdata inserts the parent record (e.g. into `books`) and gets the new record's ID
2. It inspects the join definitions to find any joins between `books` and `book_authors`
3. It reads the FK field from the join definition (`book_authors.book_id`) and sets it to the new parent ID automatically
4. It inserts the `book_authors` row with the FK wired up

The developer does not need to pass the parent ID — it is handled server-side.

### Requirements

- A join must be defined between the base table and the joined table in the admin panel
- The joined table fields must be named `joinedTableName__fieldName` (double underscore separator)
- The FK field in the joined table is determined from the join definition — do not include it in your form inputs
- The author (or other linked record) **must already exist** — Webdata Pro does not create new records in third tables inline. Send users to the author create form first, then return to add the book.

### Example — add book form with author selection

```html
<!-- Standard base table fields -->
$update[books.title]
$update[books.description]

<!-- Joined table field — author must already exist -->
<select name="book_authors__author_id">
  $[authors.id|authors.author_name]
</select>
```

### Many-to-many limitation

Each form submission creates one joined record. If a book has multiple authors, the member would need to submit the form once per author, or you can use a multi-value approach with multiple select inputs sharing the same name (`book_authors__author_id`).

For complex M:M management (adding/removing multiple links after creation), use the detail page pattern: create the parent record first, then manage linked records from the detail view using separate add/remove actions.

---

## Which fields are cascaded

Only fields with the `joinedTableName__` prefix are cascaded. Fields belonging to the base table are inserted as normal. Fields with a prefix that doesn't match a known joined table are ignored.

The FK field (as defined in the join) is always set automatically — if you include it in your form it will be overwritten by the server.
