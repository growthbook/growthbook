import { useEffect } from "react";
import { PRODUCTS } from "../data/products";
import { ProductCard } from "../components/ProductCard";
import { PromoBanner } from "../components/PromoBanner";
import { EVENT_NAMES, track } from "../lib/analytics";

export function HomePage() {
  useEffect(() => {
    track(EVENT_NAMES.viewedHome, { path: "/" });
  }, []);

  return (
    <>
      <PromoBanner />
      <section className="hero">
        <h1>Goods for everyday rituals</h1>
        <p>
          A fake storefront for practicing GrowthBook feature flags,
          experiments, and product analytics — shop like a customer, instrument
          like a PM.
        </p>
      </section>
      <section className="grid" aria-label="Products">
        {PRODUCTS.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </section>
    </>
  );
}
