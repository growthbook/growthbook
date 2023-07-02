<script lang="ts">
  import type { GrowthBook } from "@growthbook/growthbook";
  import { setContext } from "svelte";
  import { writable } from "svelte/store";
  import { ContextSymbol } from "./context";
  import type { GrowthBookContext } from "./context";

  export let growthbook: GrowthBook | undefined;

  if (!growthbook) {
    // eslint-disable-next-line no-console
    console.warn("GrowthBookProvider: GrowthBook instance not provided");
  }

  const growthbookClient = writable<GrowthBook | undefined>(growthbook);
  setContext<GrowthBookContext>(ContextSymbol, { growthbookClient });

  $: growthbookClient.set(growthbook);
</script>

<slot />
