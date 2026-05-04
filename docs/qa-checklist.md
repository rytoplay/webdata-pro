# Webdata Pro — QA Test Checklist

Run this checklist before each release. It covers every feature. A fresh SQLite app named **"QA Test"** (slug `qa-test`) is created at the start and torn down at the end, so it does not pollute production data.

All tests are manual. Work top-to-bottom — later phases depend on earlier ones.

---

## Setup

- [ ] WDP is running on `http://localhost:3000`
- [ ] Log in as admin (`admin` / `changeme` or your configured password)
- [ ] Confirm the dashboard loads and the flash-message system works (create a test app then delete it — you should see a green success banner)

---

## Phase 1 — App & Schema

**Objective:** Verify that apps, tables, fields, and joins can be created and configured correctly.

### 1.1 Create app

- [ ] Go to **Apps → New App**
- [ ] Name: `QA Test`, leave database as SQLite
- [ ] Submit — confirm redirect to Tables, success flash, app appears selected in nav

### 1.2 Create tables

Create the following two tables (Tables → New Table):

| Name | Label |
|---|---|
| `contacts` | Contacts |
| `notes` | Notes |

- [ ] Both tables appear in the table list
- [ ] The physical SQLite tables exist (check with the admin data browser)

### 1.3 Create fields — one of every type

On the **contacts** table, create these fields in order:

| Field name | Label | Data type | Widget | Notes |
|---|---|---|---|---|
| `name` | Full Name | string | text | required |
| `email` | Email | string | email | |
| `phone` | Phone | string | text | |
| `bio` | Bio | text | textarea | |
| `age` | Age | integer | number | |
| `score` | Score | decimal | number | |
| `active` | Active | boolean | checkbox | |
| `joined_date` | Joined Date | date | date | |
| `last_seen` | Last Seen | datetime | datetime | |
| `avatar` | Avatar | image | image | |
| `resume` | Resume | upload | upload | allowed: pdf,doc; max: 2048 |
| `status` | Status | string | select | options: Lead, Active, Inactive |

On the **notes** table:

| Field name | Label | Data type | Widget |
|---|---|---|---|
| `contact_id` | Contact | integer | number |
| `body` | Note Body | text | textarea |
| `created_on` | Created On | date | date |

- [ ] All fields appear in the field list with correct labels and types
- [ ] The `status` select field shows options in the correct order
- [ ] The `resume` upload field shows extension and size restrictions in the field editor

### 1.4 Field indexing

On the `contacts.bio` field, enable **Fulltext Index** (if MySQL) or verify the option is present.
On the `contacts.name` field, enable the regular **Index**.

- [ ] Checkboxes save without error
- [ ] Page reloads showing the saved index state

### 1.5 Create a join

Go to **Joins → New Join**. Link `notes.contact_id` → `contacts.id`.

- [ ] Join appears in the join list with correct table/field labels
- [ ] The join diagram (if present) shows both tables connected

### 1.6 Field rename

Rename `contacts.phone` to `mobile` (label: "Mobile"):

- [ ] Rename completes without error
- [ ] Field appears as `mobile` in the field list
- [ ] No orphaned `phone` column in the physical table (check via admin data browser)

---

## Phase 2 — Data Operations (Admin)

**Objective:** Verify the admin data browser CRUD and file handling.

### 2.1 Create records

Using **Data → contacts → New Record**, create at least 3 contacts with varied data. Include:

- [ ] One record with all fields filled, including an avatar image upload
- [ ] One record with `active = true`, `status = Active`
- [ ] One record with `active = false`, `status = Inactive`, age left blank

### 2.2 Create notes

Create 2 notes linked to the same contact (`contact_id` = that contact's id).

- [ ] Notes appear in the data browser
- [ ] `contact_id` values match actual contact IDs

### 2.3 Edit a record

Edit one contact — change their name and status.

- [ ] Record saves
- [ ] Updated values appear immediately in the list

### 2.4 Delete a record

Delete one contact.

- [ ] Record disappears from list
- [ ] No SQL error

### 2.5 CSV export

Export the `contacts` table as CSV.

- [ ] Download starts
- [ ] CSV contains correct column headers and data rows

### 2.6 Image file serving

Click the avatar filename link for a contact that has an uploaded image.

- [ ] Image renders in the browser (not a 404 or permission error)

---

## Phase 3 — Views & Template Tokens

**Objective:** Verify every template section type and every token renders correctly.

Create a view: **Views → New View**, name `contacts-list`, label `Contacts`, base table `contacts`, public = on.

### 3.1 Basic field token `${table.field}`

Set the **Row** template to:

```html
<div>${contacts.name} | ${contacts.email} | ${contacts.status}</div>
```

- [ ] Preview shows actual names, emails, and statuses — not blank, not literal `${...}` text
- [ ] Each row renders a separate div

### 3.2 System variables

Set the **Header** template to:

```html
<p>Total: ${_total} | Page: ${_page} of ${_total_pages} | Sort: ${_sort} ${_dir}</p>
```

Set the **Footer** template to:

```html
${_pagination}
```

- [ ] Header shows correct total count and page number
- [ ] `${_sort}` and `${_dir}` are empty on initial load (no sort selected)
- [ ] Footer shows pagination controls if record count exceeds page size

### 3.3 `${_pk}` and `${_row_num}`

Add to the Row template: `<span>${_pk}</span> <span>${_row_num}</span>`

- [ ] Each row shows its numeric primary key
- [ ] `_row_num` increments 1, 2, 3… per page

### 3.4 Metadata tokens

Add to the Row template: `<small>${_meta__created_at} by ${_meta__created_by}</small>`

- [ ] `_meta__created_at` shows a timestamp
- [ ] `_meta__created_by` shows "Admin" or the creating member's name

### 3.5 `$if()` — truthy field

Add to the Row template:

```
$if(contacts.active, <span class="green">Active</span>, <span class="grey">Inactive</span>)
```

- [ ] Records with `active = 1` show "Active"
- [ ] Records with `active = 0` show "Inactive"

### 3.6 `$if()` — comparison operator

Add to the Row template:

```
$if(contacts.age > 30, <b>Senior</b>, <i>Junior</i>)
```

- [ ] Rows with age > 30 show "Senior"
- [ ] Rows where age is blank render the false branch (not an error)

### 3.7 `$if()` — nested

```
$if(contacts.status = Active, $if(contacts.age > 25, Both, Only Active), Neither)
```

- [ ] All four combinations render correctly

### 3.8 `$order[]` sort links

Set the **Search Form** template to:

```html
<form data-wdp-form="search">
  <input name="q" value="${_q}" placeholder="Search…">
  <button type="submit">Search</button>
</form>
```

Set the **Header** template to include:

```
$order[contacts.name, Name] | $order[contacts.joined_date, Joined]
```

- [ ] Clicking "Name" sorts ascending; clicking again sorts descending
- [ ] Arrow indicator appears next to the active sort column
- [ ] `${_sort}` and `${_dir}` update after clicking

### 3.9 `$days_since[]` and `$years_since[]`

Add to the Row template:

```
$days_since[contacts.joined_date] days ago | $years_since[contacts.joined_date] years
```

- [ ] Numeric values appear (not blank, not an error)
- [ ] A contact joined today shows 0 days

### 3.10 `$thumbnail[]` and `$img[]`

Add to the Row template: `$thumbnail[contacts.avatar]`

Add to the **Detail** template:

```html
<div data-wdp-action="back">Back</div>
$img[contacts.avatar]
<h1>${contacts.name}</h1>
```

- [ ] Row template shows a 100px thumbnail for contacts with an avatar; shows placeholder for contacts without
- [ ] Detail view shows full-size image for contacts with an avatar

### 3.11 `$sum[]` and `$avg[]`

Add to the **Footer** template:

```
Total age: $sum[contacts.age] | Avg age: $avg[contacts.age, 1]
```

- [ ] Sum and average reflect the actual data
- [ ] Blank age values are excluded (not treated as zero in avg — confirm by adding manually)

### 3.12 `$currency[]`

Add to the Footer template: `$currency[$sum[contacts.score], 2]`

- [ ] Output is formatted with thousands separators (e.g., `1,234.56`)

### 3.13 `$perpage[]`

Add to the Search Form template: `$perpage[5, 10, 25]`

- [ ] A dropdown appears with 3 options
- [ ] Changing the value re-renders with the selected page size

### 3.14 `<group>` tags (GROUP_CONCAT)

Create a second view (`contacts-with-notes`, base: contacts) with a join to notes. Set the Row template to:

```html
<div>${contacts.name}: <group delimiter=", ">${notes.body}</group></div>
```

- [ ] Each contact row shows all their note bodies comma-separated in a single row
- [ ] Contacts with no notes show an empty string (not an error)

### 3.15 `$owner[]`

(Requires a member to have created records — skip if no members exist yet. Revisit after Phase 5.)

In a member-owned view, add to the Row template:

```
Created by: $owner[contacts.name]
```

- [ ] The owning member's name appears (not blank, not an error)

### 3.16 `$search[]` per-field inputs

In the Search Form template, add:

```html
<input $search[contacts.status]>
<input $search[contacts.name]>
```

- [ ] Both inputs appear with correct `name` attributes
- [ ] Entering a value and submitting filters results correctly

### 3.17 Detail view — full field rendering

Set the Detail template to render all contact fields using `${contacts.*}` tokens.

- [ ] Navigating to a detail view (click a row) shows all field values
- [ ] `data-wdp-action="back"` link returns to the list
- [ ] `data-wdp-action="edit"` link opens the edit form

### 3.18 Edit form

Leave the Edit Form template as the WDP default (or add a minimal custom one with `$formopen`/`$formclose`).

- [ ] Edit form pre-fills all field values
- [ ] Saving updates the record
- [ ] Cancelling returns to detail without saving

### 3.19 Create form — member portal

Set the Create Form template to a custom layout using `$formopen[contacts]` / `$formclose[contacts]` with manual inputs.

- [ ] Form renders with correct field inputs
- [ ] Submitting a valid record creates it and redirects
- [ ] Required field validation fires for `name` if left blank

---

## Phase 4 — Search & Filtering

**Objective:** Verify search operators and filter behavior.

### 4.1 Keyword search

In the contacts-list view, search for a name that exists.

- [ ] Results filter correctly
- [ ] Clearing search restores full list

### 4.2 Boolean keyword operators

Create contacts named "Alice Manager", "Bob Developer", "Carol Manager".

- [ ] `Manager` returns Alice and Carol
- [ ] `Alice OR Bob` returns all three... wait, only Alice and Bob
- [ ] `Manager NOT Carol` returns only Alice
- [ ] `"Alice Manager"` (quoted) returns only Alice

### 4.3 Per-field filter operators

Using per-field filter inputs (Advanced search panel or `$search[]` inputs):

- [ ] `age > 30` returns only contacts older than 30
- [ ] `age = 25` returns only contacts aged exactly 25
- [ ] `age 20..40` (range) returns contacts aged 20–40 inclusive
- [ ] `status = Active` returns only Active contacts

### 4.4 Pagination

Set page size to 2 (via `$perpage` or view settings). With 3+ records:

- [ ] Page 1 shows 2 records
- [ ] Clicking "next page" shows the next records
- [ ] `${_total}` shows the full count, not per-page count

### 4.5 Sorting stability

Sort by `joined_date` desc, then search. Confirm:

- [ ] Sort direction is preserved after search
- [ ] Sort direction is preserved across pagination

---

## Phase 5 — Member Auth & Permissions

**Objective:** Verify login, groups, permissions, and TFA.

### 5.1 Create a group

Groups → New Group: name `Editors`, description `Can edit contacts`.

Table permissions on `contacts`: can_add ✓, can_edit ✓, can_delete ✗, manage_all ✗.
View permissions on `contacts-list`: can_view ✓, limit_to_own_records ✗.

- [ ] Group saves with permissions

### 5.2 Create a second group

Name `Owners`, `contacts`: manage_all ✓, can_delete ✓. View: can_view ✓.

### 5.3 Create members

Members → New Member:
- `alice@test.com` / `password123` → assign to **Editors**
- `bob@test.com` / `password123` → assign to **Owners**

- [ ] Both members appear in list, correct groups shown

### 5.4 Member login

Navigate to `http://localhost:3000/app/qa-test/login`.

- [ ] Login form renders
- [ ] Wrong password shows error
- [ ] Correct password redirects to member home

### 5.5 View access control

Log in as Alice (Editors). Navigate to `contacts-list`.

- [ ] View is visible to Alice
- [ ] Alice can see the create form

### 5.6 Permission: can_add

As Alice, submit a new contact via the create form.

- [ ] Record is created
- [ ] Alice is recorded as owner (check `_meta__created_by` in detail view)

### 5.7 Permission: can_edit / cannot delete

As Alice:

- [ ] Alice can open the edit form for a contact she created
- [ ] No delete button appears (or delete returns a permission error)

### 5.8 Permission: manage_all vs limit_to_own

Log in as Bob (Owners).

- [ ] Bob can see ALL contacts (not just his own)
- [ ] Bob can edit and delete any contact

Now set Alice's group to `limit_to_own_records = true` on the view.

- [ ] Alice now only sees contacts she created
- [ ] Bob still sees all contacts

### 5.9 Single-record mode

Create a group `Profile` with `single_record = true` on contacts. Create a member in this group.

- [ ] Member can create one contact
- [ ] Attempting to create a second redirects to the existing record's edit form

### 5.10 Self-registration

Enable self-registration on the Editors group. Navigate to the login page.

- [ ] A "Register" link or form is visible
- [ ] Registering creates a new member in the Editors group

### 5.11 Password reset

On the login page, click "Forgot password".

- [ ] Reset email is sent (or error if SMTP not configured — that is expected)
- [ ] Token link in email loads reset form
- [ ] Resetting password allows login with new password
- [ ] Reusing the token link shows "invalid or expired" error

### 5.12 Two-factor authentication

Enable TFA requirement on the Editors group.

- [ ] After password login, Alice is redirected to TFA setup (QR code page)
- [ ] Scanning QR code and entering TOTP code grants access
- [ ] Subsequent login asks for TOTP code after password

### 5.13 Delete member — delete all records

Delete Alice. Choose "Delete all records created by this member".

- [ ] Alice no longer appears in member list
- [ ] Records owned by Alice are deleted from contacts

### 5.14 Delete member — reassign records

Create a new member, create a record, then delete and choose "Reassign to [Bob]".

- [ ] Records transfer ownership to Bob
- [ ] `_meta__created_by` on those records now shows Bob

---

## Phase 6 — Public Forms & CAPTCHA

**Objective:** Verify anonymous form submissions and CAPTCHA protection.

### 6.1 Public table configuration

On the `contacts` table, enable **Allow public submissions**.

### 6.2 `$form[]` token

Create a new public view (`contact-form`, base: contacts, public: on). Set the Create Form template to:

```
$form[contacts]
```

- [ ] Form renders with all fields as inputs
- [ ] Submitting a valid record creates it without being logged in
- [ ] Required field validation fires

### 6.3 `$form[]` with hidden fields and redirect

```
$form[contacts, status=Lead, _redirect=/app/qa-test/view/contacts-list]
```

- [ ] Status is not editable by the user (hidden field)
- [ ] After submit, browser redirects to the specified URL
- [ ] Created record has `status = Lead`

### 6.4 `$formopen[]` / `$formclose[]`

In a different create form:

```html
$formopen[contacts, status=Lead]
<input name="name" placeholder="Your name">
<input name="email" placeholder="Email">
$formclose[contacts]
```

- [ ] Only the two specified inputs render
- [ ] Submit creates a record with `status = Lead` (from hidden field)

### 6.5 CAPTCHA — site key configured

Go to **Settings → CAPTCHA**. Enter a valid reCAPTCHA v2 site key and secret key.

- [ ] Settings save without error
- [ ] Returning to settings shows site key filled, secret key shows placeholder (write-only)

### 6.6 CAPTCHA injection

Reload the public create form.

- [ ] The `g-recaptcha` widget appears above the submit button
- [ ] The reCAPTCHA script tag is in the page source

### 6.7 CAPTCHA enforcement

Submit the public form without completing the CAPTCHA (e.g., use curl to POST without `g-recaptcha-response`).

- [ ] Server returns 400 (CAPTCHA required)
- [ ] No record is created

### 6.8 Disable CAPTCHA

Clear the site key in Settings → CAPTCHA.

- [ ] Public form no longer shows the CAPTCHA widget
- [ ] Form submits successfully without a token

---

## Phase 7 — Cascade Insert (Joined Tables)

**Objective:** Verify that a single form can create records in multiple tables simultaneously.

### 7.1 Setup

Ensure the `notes.contact_id` → `contacts.id` join exists (Phase 1.5).

### 7.2 Cascade insert via member create form

Create a view with base table `contacts`. In the Create Form template, add:

```html
$formopen[contacts]
<input name="name" placeholder="Name" required>
<input name="email" placeholder="Email">
<hr>
<textarea name="notes__body" placeholder="First note (optional)"></textarea>
$formclose[contacts]
```

- [ ] Submitting with a note body creates both the contact AND the note in one request
- [ ] The note's `contact_id` is set to the newly created contact's ID
- [ ] Submitting without a note body creates only the contact (no empty note record)

### 7.3 Cascade insert via public form

Use `$form[contacts]` on a public view, adding `notes__body` as a visible or hidden field.

- [ ] Anonymous submission creates both records without login

---

## Phase 8 — Gallery & File Uploads

**Objective:** Verify the photo gallery widget, drag-reorder, and file upload restrictions.

### 8.1 Create a gallery table

On the `contacts` table, in the field editor, create a gallery (linked photos table). WDP creates a `contacts_photos` table automatically.

- [ ] `contacts_photos` appears in the table list

### 8.2 Gallery in detail view

Add `$gallery[contacts_photos]` to the contacts detail template.

- [ ] An empty gallery widget renders on a contact detail page
- [ ] Clicking "Add Photo" opens a file picker

### 8.3 Upload photos

Upload 3 photos for one contact via the gallery widget.

- [ ] All 3 photos appear in the gallery
- [ ] Each photo has a delete button

### 8.4 Drag reorder

Drag one photo to a different position.

- [ ] Order is saved (reload the page — order persists)

### 8.5 Delete a photo

Delete one photo from the gallery.

- [ ] Photo disappears from the gallery
- [ ] File is removed from storage (no orphan)

### 8.6 `$thumbnail[]` from gallery

Add `$thumbnail[contacts_photos]` to the contacts-list Row template.

- [ ] The first photo in each contact's gallery appears as a 100px thumbnail in the list
- [ ] Contacts with no photos show the placeholder

### 8.7 Upload field restrictions

Try uploading a `.exe` file to the `resume` upload field (allowed: pdf, doc).

- [ ] Upload is rejected with an error
- [ ] Try an oversized file (> 2048 KB) — also rejected

### 8.8 Image field

Upload an image to the `avatar` image field via the admin data editor.

- [ ] Image is stored and `$img[contacts.avatar]` renders it in the detail view
- [ ] `$thumbnail[contacts.avatar]` shows a 100px crop in the row template

---

## Phase 9 — Admin Notifications

**Objective:** Verify email notification triggers on record changes.

### 9.1 SMTP configuration

Go to Settings → SMTP. Enter valid SMTP credentials (or use a local mail catcher like Mailpit).

- [ ] "Test Email" button sends a delivery confirmation to the admin email

### 9.2 Enable notifications

In App Settings, set **Notify admin on** = `contacts`, mode = Immediate.

### 9.3 Notification on insert

Create a new contact record (via admin data browser or member portal).

- [ ] Admin receives an email with the new record's details

### 9.4 Notification on update

Edit an existing contact.

- [ ] Admin receives an email noting the change

### 9.5 Notification on delete

Delete a contact.

- [ ] Admin receives a deletion notification

---

## Phase 10 — CORS & embed.js

**Objective:** Verify the embed widget works cross-origin.

### 10.1 Configure CORS

In App Settings, set Allowed Origins to `http://localhost:8111` (or your static site origin).

- [ ] Setting saves

### 10.2 Verify CORS headers

```
curl -I -H "Origin: http://localhost:8111" http://localhost:3000/api/v/qa-test/contacts-list
```

- [ ] Response includes `Access-Control-Allow-Origin: http://localhost:8111`

### 10.3 embed.js mount

In any external HTML page, add:

```html
<div id="wdp"></div>
<script src="http://localhost:3000/static/embed.js"></script>
<script>
WDP.mount('#wdp', { app: 'qa-test', view: 'contacts-list', baseUrl: 'http://localhost:3000' });
</script>
```

- [ ] View renders inside the `#wdp` container
- [ ] Search, pagination, and detail navigation all work within the embed
- [ ] No CORS errors in browser console

### 10.4 Embed — create form

Navigate to the create form within the embed.

- [ ] Form renders
- [ ] Submit creates a record and returns to the list

---

## Phase 11 — Blueprint

**Objective:** Verify the blueprint import creates the correct schema and data.

### 11.1 Apply a minimal blueprint

With QA Test app selected, go to Blueprint and paste:

```json
{
  "tables": [{
    "table_name": "tasks",
    "label": "Tasks",
    "fields": [
      { "field_name": "title",    "label": "Title",    "data_type": "string",  "is_required": true },
      { "field_name": "done",     "label": "Done",     "data_type": "boolean", "ui_widget": "checkbox" },
      { "field_name": "due_date", "label": "Due Date", "data_type": "date" }
    ]
  }],
  "sample_data": {
    "tasks": [
      { "title": "First task", "done": 0, "due_date": "2026-01-01" },
      { "title": "Second task", "done": 1, "due_date": "2026-02-01" }
    ]
  }
}
```

- [ ] Success flash: "Created: 1 table(s), 3 field(s), 2 sample record(s)"
- [ ] `tasks` table appears in table list with correct fields
- [ ] 2 records appear in the data browser

### 11.2 Idempotency

Apply the exact same blueprint again.

- [ ] No duplicate table or fields are created
- [ ] Flash may say "Nothing was created" or similar — no error

### 11.3 Validation error

Apply a blueprint with a missing `table_name`:

```json
{ "tables": [{ "label": "Bad", "fields": [{ "field_name": "x", "data_type": "string" }] }] }
```

- [ ] Error flash is shown
- [ ] No table is created

Note: unknown `data_type` values are intentionally silently mapped to `string` (AI models sometimes invent type names), so that is not a validation error.

---

## Phase 12 — Portal & Member Home

**Objective:** Verify portal navigation, custom CSS, and home templates.

### 12.1 Portal header/footer

In App Settings, set Member Header HTML to:

```html
<header style="background:#222;color:white;padding:1rem;">QA Portal</header>
```

In the Editors group, set the same header.

- [ ] Member portal shows the header after login

### 12.2 Custom member CSS

In App Settings, set Member CSS URL to a valid external stylesheet URL.

- [ ] CSS loads in the member portal (check browser network tab)

### 12.3 Home template

In the Editors group, set a home template (Nunjucks) that includes a link to the contacts-list view.

- [ ] After login, the member sees the custom home page
- [ ] The view link works

### 12.4 `$portal_header` and `$portal_footer` tokens

Add `$portal_header` to the search_form template of contacts-list.

- [ ] Portal header HTML is rendered inside the WDP view widget
- [ ] Does not appear on public/unauthenticated access (renders blank)

### 12.5 Post-logout redirect

In the Editors group, set a logout redirect URL to `/app/qa-test/login`.

- [ ] Logging out redirects to the login page rather than a generic page

---

## Phase 13 — Advanced SQL Mode

**Objective:** Verify custom SQL queries work in views.

### 13.1 Switch a view to Advanced SQL

On contacts-list, go to Templates, switch to Advanced SQL mode. Enter:

```sql
SELECT contacts.id, contacts.name, contacts.status, contacts.age
FROM contacts
WHERE contacts.status != 'Inactive'
ORDER BY contacts.name ASC
```

- [ ] View renders only Active/Lead contacts
- [ ] Row template tokens `${contacts.name}` etc. still resolve correctly

### 13.2 Parameterized keyword search in custom SQL

Add a `WHERE` clause that uses `:q`:

```sql
SELECT contacts.id, contacts.name FROM contacts
WHERE (:q = '' OR contacts.name LIKE '%' || :q || '%')
```

- [ ] Keyword search filters results via the custom SQL

---

## Phase 14 — Teardown

- [ ] Go to Apps, select QA Test, delete it
- [ ] Confirm: app is gone, all related tables/views/members/templates removed
- [ ] SQLite data file for the app is deleted or empty

---

## Pass Criteria

The build passes QA if every checkbox above is checked and no step produces:
- An unhandled SQL error or stack trace visible to the user
- A blank or `${...}` literal where a rendered value was expected
- A 500 response on any documented endpoint
- A permission bypass (member accessing data they should not see)
- Data loss from a cascade that should not have fired

---

## Quick Regression Checklist

For minor patches where a full run is impractical, run at minimum:

- [ ] Phase 1.1 (create app)
- [ ] Phase 2.1 (create record)
- [ ] Phase 3.1 (field token renders)
- [ ] Phase 3.5 (`$if` truthy)
- [ ] Phase 3.10 (`$thumbnail` / `$img`)
- [ ] Phase 3.14 (`<group>` tags)
- [ ] Phase 5.4 (member login)
- [ ] Phase 5.7 (permission check)
- [ ] Phase 6.2 (`$form[]` public submit)
- [ ] Phase 7.2 (cascade insert)
- [ ] Phase 8.3 (gallery upload)
- [ ] Phase 14 (teardown)
