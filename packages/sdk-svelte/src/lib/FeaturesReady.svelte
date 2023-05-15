<script lang="ts">
  import { onMount } from "svelte";
  import { useGrowthBook } from "./useGrowthBook";

  export let timeout: number | undefined;

  const growthbook = useGrowthBook();
  const ready = growthbook ? growthbook.ready : false;
  let hitTimeout = false;

  onMount(() => {
    if (timeout && !ready) {
      const timer = setTimeout(() => {
        growthbook &&
          growthbook.log("FeaturesReady timed out waiting for features to load", {
            timeout,
          });
        hitTimeout = true;
      }, timeout);

      return () => clearTimeout(timer);
    }
  });
</script>

{#if ready || hitTimeout}
  <slot />
{:else}
  <slot name="fallback" />
{/if}
