/**
 * Feature / experiment keys expected in GrowthBook.
 * Create these in the GrowthBook UI when dogfooding — see README.
 */
export const FLAGS = {
  /** Boolean — show homepage promo banner when on */
  promoBanner: "shop_promo_banner",
  /** String experiment — product CTA copy */
  ctaCopy: "shop_cta_copy",
  /** Boolean — show free-shipping badge on product cards/detail */
  freeShippingBadge: "shop_free_shipping_badge",
  /** String experiment — "classic" | "express" checkout layout */
  checkoutFlow: "shop_checkout_flow",
} as const;

export const CTA_DEFAULT = "Add to cart";
export const CTA_VARIANTS = ["Add to cart", "Buy now", "Get yours"] as const;

export const CHECKOUT_DEFAULT = "classic";
