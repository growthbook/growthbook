import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { FLAGS } from "../lib/flags";

export function FreeShippingBadge() {
  const on = useFeatureIsOn(FLAGS.freeShippingBadge);
  if (!on) return null;
  return <span className="badge">Free shipping</span>;
}
