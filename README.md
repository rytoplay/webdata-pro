# Webdata Pro

**Turn any database into a searchable widget you can put on any website — no back-end experience required.**

You describe what you want in plain English. The AI builds the tables, the search forms, and the sample data. When you're ready, you copy two lines of code and paste them into any web page.

**Great for:** animal shelters, libraries, real estate listings, product catalogs, event directories, member rosters — anything where you have data and want people to search it.

---

## What you'll need

| Program | What it does | Where to get it |
|---|---|---|
| **Node.js 18 or higher** | Runs the Webdata Pro server | [nodejs.org](https://nodejs.org) — click the **LTS** button |
| **Ollama** *(optional)* | Powers the AI app builder | [ollama.com](https://ollama.com) |

> **About Ollama:** You only need it if you want to use the AI builder. If you prefer to set up your database by hand, you can skip Ollama entirely and do everything manually through the admin panel.

### If you're using the AI builder — install the AI model

After installing Ollama, open a terminal and run this once:

```
ollama pull qwen2.5:7b
```

This downloads the AI model (about 4.7 GB — roughly 20 minutes on a typical home connection). Ollama runs quietly in the background after that — you don't need to start it separately.

> **Want better results?** The larger `qwen2.5:14b` model (9 GB) produces higher-quality output and handles more complex descriptions. If you have fast internet and at least 16 GB of RAM, run `ollama pull qwen2.5:14b` instead, then select it under **Admin → Settings → AI Model**.

---

## Installation

### Step 1 — Download Webdata Pro

**Option A — Git** (if you have it installed):
```bash
git clone https://github.com/rytoplay/webdata-pro.git
cd webdata-pro
```

**Option B — ZIP file:**
1. Click the green **Code** button at the top of this page
2. Click **Download ZIP**
3. Unzip the downloaded file
4. Open a terminal and `cd` into the folder

### Step 2 — Install the required packages

```bash
npm install
```

This downloads everything Webdata Pro needs. It may take a minute or two.

### Step 3 — Create your settings file

```bash
cp .env.example .env
```

This creates a file called `.env` that controls your server settings. Open it in any text editor:

```
PORT=3456
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
SESSION_SECRET=change-this-to-a-long-random-string-in-production
```

**Change `ADMIN_PASSWORD` to something strong before you share this with anyone.** The admin account has full access to every database you create — treat the password like a house key.

Also replace `SESSION_SECRET` with any long random phrase (it doesn't matter what it says — just make it unique to you).

### Step 4 — Start the server

```bash
npm run dev
```

You should see something like:

```
Webdata Pro 2.0 running at http://localhost:3456
Admin panel: http://localhost:3456/admin
```

Open your browser and go to **http://localhost:3456/admin**

> **Port already in use?** Edit your `.env` file and change `PORT=3456` to any other number, like `4000` or `8080`.

---

## Your first app (about 5 minutes)

### 1. Log in

- **Username:** `admin`
- **Password:** whatever you set in your `.env` file (default is `changeme`)

### 2. Create a new app

Click **New App** on the dashboard. Give it a name — for example, *"Pet Shelter"*.

Each app gets its own database, its own address, and its own embed code. You can have as many apps as you want.

### 3. Build with AI

Click **AI Builder** in the left menu. You'll see a text box. Describe your database in plain English — for example:

> *"I want a searchable database of pets available for adoption. Each pet has a name, animal type (dog, cat, rabbit), breed, date of birth, temperament, and whether they are good with kids."*

Click **Build App**. The AI will create your tables, set up the fields, build search views, and add sample data — usually in under a minute.

### 4. See it working

Click **Views** in the left menu. You'll see one or two views that the AI created. Click **Preview** next to any of them.

You'll see a working, searchable widget right in your browser. Type a name into the search box and press Search. It works.

### 5. Put it on a website

On the Preview page, look for the **Embed Code** section. You'll see something like this:

```html
<script src="http://localhost:3456/static/embed.js"></script>

<div id="wdp-pets_browse"></div>

<script>
  WDP.mount('#wdp-pets_browse', {
    app:     'pet-shelter',
    view:    'pets_browse',
    baseUrl: 'http://yourserver.com'
  });
</script>
```

Copy those lines and paste them into any HTML page. Change `baseUrl` to your server's actual address. The widget will appear and work on that page.

> **Embedding on a different website?** If your website is hosted somewhere other than this server (a different domain or port), go to **App Settings** in the left menu and add your website's address to the **Allowed Origins** list. For example: `https://mywebsite.com`. This is a security feature — it controls which websites are allowed to load your data.

---

## Adjusting your app

Everything in Webdata Pro can be changed after the AI builds it:

| Section | What you can do |
|---|---|
| **Tables** | Add, rename, or remove fields |
| **Data** | Browse, add, edit, or delete records |
| **Views** | Customize how search results look using HTML templates |
| **Groups & Members** | Control who can log in and what they can see |
| **SQL Console** | Run raw SQL queries directly against your database |
| **App Settings** | Set allowed origins for cross-site embedding |

---

## Changing your admin password

Open your `.env` file, change `ADMIN_PASSWORD`, and restart the server with `npm run dev`.

There is no "forgot password" link for the admin account — it lives entirely in your `.env` file.

---

## Running Webdata Pro on a server (always-on)

When you're ready to move beyond your laptop, the simplest path is a one-click cloud host:

- **Railway** — free tier available, easy environment variable setup
- **Render** — similar to Railway, good free tier
- **Any VPS** (DigitalOcean, Linode, etc.) — run `npm run build` then `npm start`

For cloud hosts, set these environment variables in their dashboard:

| Variable | What to set |
|---|---|
| `ADMIN_PASSWORD` | A strong password |
| `SESSION_SECRET` | A long random string |
| `NODE_ENV` | `production` |
| `PORT` | Usually set automatically by the host |

---

## Troubleshooting

**"npm: command not found"**
Node.js is not installed. Download it from [nodejs.org](https://nodejs.org) and try again.

**"Cannot find module" or similar error on startup**
Run `npm install` again — some packages may not have downloaded correctly.

**The AI builder doesn't respond or gives an error**
- Make sure Ollama is installed and running
- Open a terminal and run `ollama pull qwen2.5:14b` to confirm the model is downloaded
- Go to **Admin → Settings** and confirm the AI provider is set to **Ollama**

**"I can't log in"**
Your username and password come from the `.env` file — check `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

**The embed widget loads on my site but search doesn't work**
Your website's address is not in the Allowed Origins list. Go to **Admin → App Settings** and add it.

---

## License

MIT — free to use, modify, and share.
