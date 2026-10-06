<!-- PROTOTYPE ONLY: a demo spec for "Set up with AI" in Create Experiment.
Attach it in a demo; the dev-only fixture (components/Experiment/TabbedPage/
SetupPage/aiSetupFixture.ts) matches it exactly. Not used by the app. -->

# Promo banner placement — experiment spec

Owner: Growth · Drafted for Q4 checkout work

## Background

The promo banner currently sits above the fold on the cart page. Session
recordings show a meaningful share of mobile users scrolling straight past it,
and we suspect it's pushing the primary CTA down far enough to cost us orders.
Moving it below the fold should recover that space without losing the promo
entirely.

## Hypothesis

Moving the promo banner below the fold on the cart page will reduce bounce rate
without reducing completed orders, because the primary CTA becomes visible
without scrolling.

## Experiment type

Inline values — the banner position is controlled by a single flag value read
at render time.

## Variations

**Control — Banner above fold**
Current behaviour. The promo banner renders above the primary CTA.
Value: `above`

**Variant — Banner below fold**
The promo banner renders beneath the primary CTA, inside the order summary
block.
Value: `below`

## Targeting

Logged-in users on mobile devices. United States only for this first run — we
want a clean read before extending to other markets.

## Traffic

65 / 35 split, weighted toward control. We're protecting a revenue-adjacent
surface and want the smaller exposure on the variant.

## Duration

Run for 12 days. That covers two full weekends, which matters because cart
behaviour differs sharply between weekday and weekend traffic.

## Metrics

Goal metric: Any Purchases

Secondary: Average Order Value — moving the promo out of the primary scroll
path may shift basket composition, not just conversion.

Guardrail: Revenue per User — the trade we actually care about is orders
against order size, and neither metric alone would catch it.

Not using D7 Purchase Retention. At 12 days we'd have roughly five days of
matured D7 data, which isn't enough to read.

## Notes

Do not ship alongside the free-shipping threshold test — both touch the order
summary block and the interaction would be impossible to untangle.
