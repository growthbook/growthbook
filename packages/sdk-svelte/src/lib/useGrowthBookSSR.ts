import { onMount } from "svelte";
import type { GrowthBookSSRData } from "./getGrowthBookSSRData";
import { useGrowthBook } from "./useGrowthBook";

export function useGrowthBookSSR(data: GrowthBookSSRData) {
  const gb = useGrowthBook();

  let isFirst = true;

  onMount(() => {
    if (!gb || !isFirst) return;
    isFirst = false;

    gb.setAttributes(data.attributes);
    gb.setFeatures(data.features);
  });
}
