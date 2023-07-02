<script lang="ts">
  import { getContext } from "svelte";
  import { ContextSymbol } from "./context";
  import type { GrowthBookContext } from "./context";

  export let timeout = 0;

  const { growthbookClient } = getContext<GrowthBookContext>(ContextSymbol);
  $: ready = $growthbookClient?.ready || false;
  let hitTimeout = false;

  $: {
    if (timeout !== 0 && !ready) {
      setTimeout(() => {
        $growthbookClient &&
          $growthbookClient.log(
            "FeaturesReady timed out waiting for features to load",
            {
              timeout,
            }
          );
        hitTimeout = true;
      }, timeout);
    }
  }
</script>

{#if ready || hitTimeout}
  {#key ready}
    <slot name="primary" />
  {/key}
{:else}
  <slot name="fallback" />
{/if}
