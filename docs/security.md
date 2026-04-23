# Security

Webdata Pro is designed so that members only ever see the data they are supposed to see — and nothing more.

**Group-based permissions.** Every member belongs to one or more groups. Each group has explicit permissions: which views they can browse, which tables they can edit, whether they can add or delete records, and whether they can see everyone's records or only their own. A member without permission to a view or table cannot reach it, regardless of whether they guess the URL.

**Ownership enforcement.** By default, members can only edit and delete records they created. A "Manage All" flag is available for staff or admin groups who need to see everyone's data — but it must be explicitly granted. Ownership is tracked in a separate metadata table so it cannot be spoofed through a form field.

**Passwords hashed with bcrypt.** Member passwords are never stored in plain text. Webdata Pro uses bcrypt with 12 salt rounds, the same standard used by production web frameworks. Password reset tokens are cryptographically random, single-use, and expire after 60 minutes.

**Two-factor authentication.** Each group can require TOTP-based two-factor authentication at login. Members in those groups are prompted to set up an authenticator app and must provide a valid code on every sign-in.

**File access follows data permissions.** Uploaded files (images, documents) are served through a permission-checked route, not as public static files. A member cannot access a file unless they already have permission to the table or view it belongs to. Files are stored with UUID-generated names — not the original filename — so directory contents cannot be guessed.

**No SQL injection.** All database queries are built with the Knex query builder using parameterized values. User input is never interpolated directly into SQL strings. The one exception is the admin SQL console, which is protected by its own CSRF token and only accessible to the authenticated admin.

**XSS protection.** All template output is HTML-escaped by default through the Nunjucks templating engine. Variables are only rendered unescaped when explicitly marked safe by the application code.

**Path traversal protection.** File-serving routes validate every URL segment against a strict allowlist (alphanumeric, underscores, hyphens) before constructing a file path, preventing directory traversal attacks.

> **Deployment note:** For a public-facing server, put Webdata Pro behind a reverse proxy (nginx, Caddy) that handles HTTPS. Without HTTPS, session cookies travel in plain text.
