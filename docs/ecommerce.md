# E-Commerce Integration

Webdata Pro does not include a built-in shopping cart, but it is straightforward to add one using either of the two most popular options for independent sites. Both work by layering checkout functionality on top of your existing Webdata Pro templates — you keep your product catalog and search experience; the cart provider handles payment and order processing.

---

## Option A — Snipcart (easiest, no back-end code)

[Snipcart](https://snipcart.com) is a cart-as-a-service that works entirely through HTML attributes. Include their script once, add a few `data-*` attributes to your "Add to Cart" buttons, and a full cart drawer and checkout flow appear automatically — no new routes, no server changes.

**1. Add the Snipcart script to your page**

```html
<link rel="stylesheet" href="https://cdn.snipcart.com/themes/v3.3.3/default/snipcart.css" />
<script async src="https://cdn.snipcart.com/themes/v3.3.3/default/snipcart.js"></script>
<div hidden id="snipcart" data-api-key="YOUR_PUBLIC_API_KEY"></div>
```

Replace `YOUR_PUBLIC_API_KEY` with the key from your Snipcart dashboard.

**2. Add "Add to Cart" buttons in your row or detail template**

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

## Option B — Stripe Checkout (lower fees, requires one back-end route)

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
        unit_amount:  Math.round(product.price * 100),
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
">Buy Now — ${currency[products.price,2]}</button>
```

**Cost:** 2.9% + 30¢ per transaction. No monthly fee.

---

## Comparison

| | Snipcart | Stripe Checkout |
|---|---|---|
| Back-end code required | None | ~40 lines |
| Cart experience | In-page drawer | Redirect to Stripe |
| Monthly fee | $10/mo | None |
| Per-transaction fee | 2.9% + 30¢ + 1.5% | 2.9% + 30¢ |
| Multi-item cart | Built-in | Requires session-based cart logic |
| Best for | Quick setup, multi-item orders | Single-item purchases or lower volume |

For a small shop wanting to get selling quickly, **Snipcart** is the faster path. For a higher-volume shop wanting lower fees and tighter control, **Stripe Checkout** is the better long-term choice.
