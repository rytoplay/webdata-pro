# Deployment

## Running on a VPS (always-on)

Build the app and start it with Node:

```bash
npm run build
npm start
```

Set these environment variables on your server:

| Variable | What to set |
|---|---|
| `ADMIN_PASSWORD` | A strong password |
| `SESSION_SECRET` | A long random string |
| `NODE_ENV` | `production` |
| `DATA_DIR` | Path to a persistent directory, e.g. `/var/lib/webdata-pro` |

`PORT` defaults to 3000. Set it if you need a different port.

## Recommended: put Webdata Pro behind a reverse proxy

For a public-facing server, run Webdata Pro behind **nginx** or **Caddy** so that HTTPS is handled at the proxy layer. Without HTTPS, session cookies travel in plain text.

**Caddy** (simplest — automatic HTTPS):

```
yourdomain.com {
  reverse_proxy localhost:3000
}
```

**nginx:**

```nginx
server {
  listen 443 ssl;
  server_name yourdomain.com;
  # ... SSL cert config ...
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## Cloud hosting

- **Render** — free tier available, deploy from GitHub
- **Railway** — $5/month Hobby plan, persistent volumes included

## Keeping the process alive

Use **PM2** to keep the server running after logout and restart it on crash:

```bash
npm install -g pm2
pm2 start dist/server.js --name webdata-pro
pm2 save
pm2 startup
```

## SQLite backups

Your data lives in `$DATA_DIR` (or `./data` if not set). Back it up by copying the directory:

```bash
cp -r /var/lib/webdata-pro /var/backups/webdata-pro-$(date +%Y%m%d)
```

For a MySQL app, use `mysqldump`:

```bash
mysqldump -u user -p dbname > backup.sql
```

## Bulk template find-and-replace

If you need to rename a token or string across all templates at once, use the SQL console:

```sql
UPDATE templates SET content_html = REPLACE(content_html, 'old_text', 'new_text');
```
