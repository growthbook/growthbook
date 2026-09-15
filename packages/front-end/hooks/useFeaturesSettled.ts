import { useEffect, useState } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";

// True once the feature payload has loaded, or after a short wait when it never
// does. For decisions made once, such as a redirect, which must not run on
// unloaded flags; anything that simply re-renders can read the flag directly.
export default function useFeaturesSettled(fallbackMs = 1500): boolean {
  const gb = useGrowthBook<AppFeatures>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (gb?.ready) {
      setSettled(true);
      return;
    }
    const timer = setTimeout(() => setSettled(true), fallbackMs);
    return () => clearTimeout(timer);
  }, [gb, gb?.ready, fallbackMs]);
  return settled;
}
