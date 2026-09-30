import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { FLAGS } from "../lib/flags";

export function PromoBanner() {
  const on = useFeatureIsOn(FLAGS.promoBanner);
  if (!on) return null;

  return (
    <aside className="promo-banner" data-flag={FLAGS.promoBanner}>
      <div>
        <strong>Spring restock is live</strong>
        <p>Free shipping on orders over $50 — this week only.</p>
      </div>
    </aside>
  );
}
