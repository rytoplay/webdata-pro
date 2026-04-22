# Webdata Pro

**Build data-driven web apps without hand-coding the back end.**

Webdata Pro is a visual builder for database-powered websites and applications. Describe your project in plain English and the AI builds your tables, search forms, and sample records. Or skip the AI and set everything up by hand through the admin panel. Either way, you stay in full control — of your tables, fields, templates, permissions, and data — from first prototype to working application.

**Built for:** product catalogs, member directories, event listings, real estate databases, animal shelters, school projects, small business tools, staff rosters, internal directories — any project where you have structured data that people need to search, browse, or manage.

---

## Safe and secure

Webdata Pro is designed so that members only ever see the data they are supposed to see — and nothing more.

**Group-based permissions.** Every member belongs to one or more groups. Each group has explicit permissions: which views they can browse, which tables they can edit, whether they can add or delete records, and whether they can see everyone's records or only their own. A member without permission to a view or table cannot reach it, regardless of whether they guess the URL.

**Ownership enforcement.** By default, members can only edit and delete records they created. A "Manage All" flag is available for staff or admin groups who need to see everyone's data — but it must be explicitly granted. Ownership is tracked in a separate metadata table so it cannot be spoofed through a form field.

**Passwords hashed with bcrypt.** Member passwords are never stored in plain text. Webdata Pro uses bcrypt with 12 salt rounds, the same standard used by production web frameworks. Password reset tokens are cryptographically random, single-use, and expire after 60 minutes.

**Two-factor authentication.** Each group can require TOTP-based two-factor authentication at login. Members in those groups are prompted to set up an authenticator app and must provide a valid code on every sign-in.

**File access follows data permissions.** Uploaded files (images, documents) are served through a permission-checked route, not as public static files. A member cannot access a file unless they already have permission to the table or view it belongs to. Files are stored with UUID-generated names — not the original filename — so directory contents cannot be guessed.

**No SQL injection.** All database queries are built with the Knex query builder using parameterized values. User input is never interpolated directly into SQL strings. The one exception is the admin SQL console, which is protected by its own CSRF token and only accessible to the authenticated admin.

**XSS protection.** All template output is HTML-escaped by default through the Nunjucks templating engine. Variables are only rendered unescaped when explicitly marked safe by the application code.

**Path traversal protection.** File-serving routes validate every URL segment against a strict allowlist (alphanumeric, underscores, hyphens) before constructing a file path, preventing directory traversal attacks.

> **Deployment note:** For a public-facing server, put Webdata Pro behind a reverse proxy (nginx, Caddy) that handles HTTPS. Without HTTPS, session cookies travel in plain text. See the [Running on a server](#running-webdata-pro-on-a-server-always-on) section.

---

## AI-assisted, designer-controlled
<!-- TODO: revise this section when closer to release -->

There are plenty of tools that promise to build your app in minutes with AI. The problem is that once the AI is done, you're working inside a black box — locked into their styling system, their embed limitations, their notification pipeline, their platform. Customising anything beyond what the tool anticipated is a fight.

Webdata Pro takes a different approach. The AI handles the tedious structural work — generating your tables, fields, search forms, and starter templates — but everything it produces is plain HTML templates and SQL that you can read, edit, and fully control. There is no magic layer between you and the output. Your public-facing search widget is a single `<script>` tag that inherits whatever CSS your website already uses. Your staff management interface is a template you redesign however you like. Your forms post data to your own database. Your notifications go to your own email. The AI gets you to a working first draft in minutes; the designer takes it the rest of the way on their own terms.

---

## What you'll need

**Node.js 18 or higher** — this runs the Webdata Pro server.
Download it from [nodejs.org](https://nodejs.org) and click the **LTS** button.

Webdata Pro includes its own web server, database engine, admin panel, and embed system. No other software is required to get started.

> **Want to use the AI builder?** After Webdata Pro is running, you can connect it to an AI service — a free local install or a cloud provider. Full details are in the [Optional: Choose an AI for the App Builder](#optional-choose-an-ai-for-the-app-builder) section at the bottom of this page.

---

## What a first session looks like

1. Install Webdata Pro and open the admin page in your browser
2. Create a new app and give it a name
3. Use the AI builder — or set up your tables by hand — to define your database
4. Preview a working, searchable application right in the browser
5. Paste the embed block into any web page and your app is live there

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

This downloads everything Webdata Pro needs to run. It takes a minute or two.

### Step 3 — Create your settings file

```bash
cp .env.example .env
```

This creates a file called `.env` that holds your server settings. Open it in any text editor:

```
PORT=3456
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
SESSION_SECRET=change-this-to-a-long-random-string
```

**Change `ADMIN_PASSWORD` before you share the app with anyone.** The admin account has full control over your data — treat it like a house key.

Also replace `SESSION_SECRET` with any long phrase of your choosing. It doesn't matter what it says — just make it unique to you.

### Step 4 — Start the server

```bash
npm run dev
```

You should see:

```
Webdata Pro 2.0 running at http://localhost:3456
Admin panel: http://localhost:3456/admin
```

Open your browser and go to **http://localhost:3456/admin**

> **Port already in use?** Edit `.env` and change `PORT=3456` to any other number, like `4000`.

---

## Your first app (about 5 minutes)

### 1. Log in

- **Username:** `admin`
- **Password:** whatever you set in `.env` (default is `changeme`)

### 2. Create a new app

Click **New App** on the dashboard. Give it a name — for example, *"Pet Adoption"*.

Each app gets its own database, its own URL, and its own embed code. You can run as many apps as you need from a single Webdata Pro installation.

### 3. Build your app

**With the AI builder:** Click **AI Builder** in the left menu and describe your project in plain English:

> *"I want a searchable database of pets available for adoption. Each pet has a name, animal type, breed, date of birth, temperament, and whether they are good with kids."*

Click **Build App**. The AI creates your tables, sets up the fields, and adds sample records — usually in under a minute.

**Without AI:** Go to **Tables** in the left menu and add your tables and fields by hand, then use **Data** to enter records. It takes a little longer but gives you full control from the start.

### 4. Preview your app

Click **Views** in the left menu and click **Preview** next to any view.

You'll see a working, searchable application in your browser. Search, filtering, pagination, and detail views are all handled automatically — no additional code required.

### 5. Put it on a website

On the Preview page, look for the **Embed Code** section. You'll see an embed block like this:

```html
<script src="http://yourserver.com/static/embed.js"></script>

<div id="wdp-pets_browse"></div>

<script>
  WDP.mount('#wdp-pets_browse', {
    app:     'pet-adoption',
    view:    'pets_browse',
    baseUrl: 'http://yourserver.com'
  });
</script>
```

Paste that block into any HTML page and replace `yourserver.com` with your server's actual address.

**Still testing locally?** Use `http://localhost:3456` as the `baseUrl`. When you move to a real server, update it to that server's address.

> **Embedding on a different website?** Go to **App Settings** and add your website's address to the **Allowed Origins** list — for example: `https://mywebsite.com`. This security setting controls which sites are permitted to load your data.

---

## Adjusting your app

Everything can be changed after the initial build:

| Section | What you can do |
|---|---|
| **Tables** | Add, rename, or remove fields |
| **Data** | Browse, add, edit, or delete records |
| **Views** | Customize how results look using HTML templates |
| **Groups & Members** | Control who can log in and what they can see |
| **SQL Console** | Run queries directly against your database |
| **App Settings** | Set allowed origins for embedding on other sites |

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
- For Ollama: make sure it's running and the model is downloaded (`ollama pull qwen2.5:7b`)
- For cloud providers: check that your API key is saved in **Admin → Settings**

**"I can't log in"**
Your username and password come from the `.env` file — check `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

**My app loads on another site but search doesn't work**
Your website's address is not in the Allowed Origins list. Go to **App Settings** and add it.

---

## Optional: Choose an AI for the App Builder

You only need this section if you want to use the AI-powered app builder. If you'd rather build your database by hand, skip it — Webdata Pro is fully functional without AI.

### Option A — Use a cloud AI service (nothing to download)

Sign up for an account with any of these providers, get an API key, and paste it into **Admin → Settings**:

| Provider | Good starting model | Get a key |
|---|---|---|
| Anthropic (Claude) | `claude-haiku-4-5-20251001` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (ChatGPT) | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |
| Google (Gemini) | `gemini-2.0-flash` | [aistudio.google.com](https://aistudio.google.com) |

All three offer pay-as-you-go pricing. Building a typical app costs a fraction of a cent.

### Option B — Run your own AI model for free with Ollama

[Download Ollama](https://ollama.com), then open a terminal and run:

```
ollama pull qwen2.5:7b
```

This downloads an AI model to your computer (about 4.7 GB — roughly 10–20 minutes on a typical home connection). Ollama runs quietly in the background and does not need to be restarted each time.

> **Have 16 GB of RAM and a faster connection?** The larger `qwen2.5:14b` model (9 GB) gives better results. Run `ollama pull qwen2.5:14b` instead, then select it under **Admin → Settings**.

---

## E-COMMERCE

Webdata Pro does not include a built-in shopping cart, but it is straightforward to add one using either of the two most popular options for independent sites. Both work by layering checkout functionality on top of your existing Webdata Pro templates — you keep your product catalog and search experience; the cart provider handles payment and order processing.

---

### Option A — Snipcart (easiest, no back-end code)

[Snipcart](https://snipcart.com) is a cart-as-a-service that works entirely through HTML attributes. Include their script once, add a few `data-*` attributes to your "Add to Cart" buttons, and a full cart drawer and checkout flow appear automatically — no new routes, no server changes.

**1. Add the Snipcart script to your page**

```html
<link rel="stylesheet" href="https://cdn.snipcart.com/themes/v3.3.3/default/snipcart.css" />
<script async src="https://cdn.snipcart.com/themes/v3.3.3/default/snipcart.js"></script>
<div hidden id="snipcart" data-api-key="YOUR_PUBLIC_API_KEY"></div>
```

Replace `YOUR_PUBLIC_API_KEY` with the key from your Snipcart dashboard.

**2. Add "Add to Cart" buttons in your row or detail template**

In the Webdata Pro template editor, add a button like this wherever you want a buy button to appear:

```html
<button
  class="snipcart-add-item"
  data-item-id="${products.id}"
  data-item-name="${products.name}"
  data-item-price="${products.price}"
  data-item-url="/api/v/your-app-slug/all-products/${products.id}"
  data-item-description="${products.description}"
  data-item-image="/files/your-app-slug/products_photos/photo/${products.photo}">
  Add to Cart
</button>
```

Replace `your-app-slug` and the field names with your actual app slug and field names. The `data-item-url` must point to a publicly accessible URL that Snipcart can crawl to verify the price — the Webdata Pro detail view URL works for this.

**3. Done**

Snipcart handles the cart drawer, checkout form, payment (via Stripe under the hood), and confirmation emails. Orders appear in your Snipcart dashboard.

**Cost:** $10/month + 2.9% + 30¢ per transaction (plus Snipcart's 1.5% fee after the free trial).

---

### Option B — Stripe Checkout (lower fees, requires one back-end route)

[Stripe](https://stripe.com) is the most widely used payment platform. Their Checkout product gives you a hosted, mobile-optimised payment page. You add one small route to Webdata Pro's back end that creates a Checkout Session, and Stripe handles everything from there.

**1. Install the Stripe Node.js library**

```bash
npm install stripe
```

**2. Add your Stripe keys to `.env`**

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Use `sk_test_...` / `pk_test_...` keys while testing.

**3. Add a checkout route**

Create `src/routes/checkout.ts`:

```typescript
import { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db/knex';
import { getAppDb } from '../db/adapters/appDb';

export const checkoutRouter = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// POST /checkout/:appSlug  — body: { productId, quantity? }
checkoutRouter.post('/:appSlug', async (req, res) => {
  const app = await db('apps').where({ slug: req.params.appSlug }).first();
  if (!app) return res.status(404).json({ error: 'App not found' });

  const appDb   = getAppDb(app);
  const product = await appDb('products').where({ id: req.body.productId }).first();
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const session = await stripe.checkout.sessions.create({
    mode:         'payment',
    line_items:   [{
      quantity: req.body.quantity ?? 1,
      price_data: {
        currency:     'usd',
        unit_amount:  Math.round(product.price * 100),   // Stripe uses cents
        product_data: { name: product.name, description: product.description ?? undefined },
      },
    }],
    success_url: `${req.headers.origin ?? ''}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${req.headers.origin ?? ''}/`,
  });

  res.json({ url: session.url });
});
```

Register it in `src/app.ts`:

```typescript
import { checkoutRouter } from './routes/checkout';
app.use('/checkout', checkoutRouter);
```

**4. Add a "Buy Now" button to your template**

```html
<button onclick="
  fetch('/checkout/your-app-slug', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ productId: ${products.id} })
  })
  .then(r => r.json())
  .then(d => window.location = d.url)
">Buy Now — $currency[products.price,2]</button>
```

Clicking the button calls your new route, which creates a Stripe Checkout Session and redirects the customer to Stripe's hosted payment page. After payment, Stripe redirects back to your `success_url`.

**Cost:** 2.9% + 30¢ per transaction. No monthly fee.

---

### Comparison

| | Snipcart | Stripe Checkout |
|---|---|---|
| Back-end code required | None | ~40 lines |
| Cart experience | In-page drawer | Redirect to Stripe |
| Monthly fee | $10/mo | None |
| Per-transaction fee | 2.9% + 30¢ + 1.5% | 2.9% + 30¢ |
| Multi-item cart | Built-in | Requires session-based cart logic |
| Best for | Quick setup, multi-item orders | Single-item purchases or lower volume |

For a small shop wanting to get selling quickly, **Snipcart** is the faster path. For a higher-volume shop wanting lower fees and tighter control, **Stripe Checkout** is the better long-term choice.

---

## License

MIT — free to use, modify, and share.
