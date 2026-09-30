# Cedar Market — GrowthBook dogfood shop

A small fake e-commerce app for practicing GrowthBook as a customer: feature flags, A/B experiments, and product analytics.

It lives in this monorepo as `packages/dummy-shop` and uses the workspace SDKs (`@growthbook/growthbook`, `@growthbook/growthbook-react`). It does **not** import `front-end`, `back-end`, or `shared`.

## Quick start

From the **repo root**, on a branch that includes `packages/dummy-shop` (e.g. this PR branch):

```bash
pnpm install
pnpm --filter dummy-shop dev
```

`predev` builds the workspace SDKs if `packages/sdk-*/dist` is missing. You can also build them yourself (run the command alone — do not paste trailing comments on the same line):

```bash
pnpm build:sdks
```

Then open [http://localhost:5173](http://localhost:5173).

If Vite errors with `Failed to resolve entry for package "@growthbook/growthbook-react"`, the React SDK dist was not built (often because a previous `build:sdks` was interrupted). Fix with:

```bash
pnpm --filter @growthbook/growthbook-react run build
pnpm --filter dummy-shop dev
```

The shop runs with sensible defaults when GrowthBook is unreachable or no SDK key is set (flags evaluate to off / fallback values).

## Point at GrowthBook

1. Copy env template:

```bash
cp packages/dummy-shop/.env.example packages/dummy-shop/.env.local
```

2. Edit `.env.local`:

| Variable                 | Example                 | Notes                                            |
| ------------------------ | ----------------------- | ------------------------------------------------ |
| `VITE_GB_API_HOST`       | `http://localhost:3100` | Local GrowthBook API, or your cloud CDN/API host |
| `VITE_GB_CLIENT_KEY`     | `sdk-…`                 | SDK connection client key from GrowthBook        |
| `VITE_GB_DECRYPTION_KEY` | (optional)              | Only if the SDK connection encrypts features     |

3. Restart `pnpm --filter dummy-shop dev`.

4. In GrowthBook, create an **SDK Connection** that serves the features below, and ensure the app’s host is allowed if you use CORS restrictions.

The floating **Dogfood panel** (bottom-right) shows live flag values, SDK status, and recent analytics events.

## Flags & experiments to create

Create these features in GrowthBook (exact keys matter):

### 1. `shop_promo_banner` (boolean)

- **Default:** `false`
- **Effect:** Homepage promo banner (“Spring restock is live…”)
- **Practice:** Toggle on/off and refresh or wait for streaming update.

### 2. `shop_cta_copy` (string) — good A/B experiment surface

- **Default / control:** `Add to cart`
- **Suggested variations:** `Add to cart` · `Buy now` · `Get yours`
- **Effect:** Product detail primary button label (and “& checkout” action)
- **Practice:** Force-rule or experiment 50/50; confirm assignment in the dogfood panel and `Experiment Viewed` events.

### 3. `shop_free_shipping_badge` (boolean)

- **Default:** `false`
- **Effect:** “Free shipping” badge on product cards and product detail image
- **Practice:** Toggle as a simple flag, or wrap in an experiment later.

### 4. `shop_checkout_flow` (string) — checkout layout experiment

- **Default / control:** `classic`
- **Variation:** `express`
- **Effect:**
  - `classic` — shipping form first (email, name, address), then summary; “Place order”
  - `express` — summary first, email-only form, “Pay now”; callout that you’re in express
- **Practice:** Run an A/B test; use `Purchased` as the conversion metric.

## Analytics events

Events are logged to the browser console (`[analytics]`) and the dogfood panel (persisted in `localStorage`). Wire `trackingCallback` / these names into your real warehouse later if desired.

| Event               | When                      | Useful properties                               |
| ------------------- | ------------------------- | ----------------------------------------------- |
| `Viewed Home`       | Home page mount           | `path`                                          |
| `Viewed Product`    | Product detail mount      | `productId`, `name`, `price`                    |
| `Added to Cart`     | Add / buy CTA             | `productId`, `price`, `quantity`, `ctaCopy`     |
| `Viewed Cart`       | Cart page                 | `itemCount`, `subtotal`                         |
| `Started Checkout`  | Checkout with items       | `itemCount`, `subtotal`, `checkoutFlow`         |
| `Purchased`         | Mock order submit         | `revenue`, `itemCount`, `checkoutFlow`, `email` |
| `Experiment Viewed` | SDK experiment assignment | `experimentId`, `variationId`, `featureId`, …   |

Checkout is fully mocked — no payments.

## Suggested dogfood walkthrough

1. Start GrowthBook locally (`pnpm dev` / `pnpm dev:apps`) and this shop.
2. Create the four features above; publish to the SDK connection used by `.env.local`.
3. Toggle `shop_promo_banner` and `shop_free_shipping_badge` — confirm UI + dogfood panel.
4. Add an experiment on `shop_cta_copy`; open a product in two browsers / clear `cedar-market-visitor-id` to see different variants.
5. Experiment on `shop_checkout_flow`; complete a purchase; confirm `Started Checkout` + `Purchased` (+ `Experiment Viewed`).
6. In GrowthBook, attach `Purchased` (or revenue) as the goal metric and explore results once you have assignment + conversion volume.

## Scripts

```bash
pnpm --filter dummy-shop dev        # Vite dev server :5173
pnpm --filter dummy-shop build      # production build
pnpm --filter dummy-shop preview    # preview production build
pnpm --filter dummy-shop type-check
```

## Package boundaries

Allowed imports: React stack + workspace `@growthbook/growthbook` / `@growthbook/growthbook-react` only. Keep it that way so the demo stays a realistic SDK consumer, not an extension of the GrowthBook admin app.
