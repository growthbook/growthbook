<script lang="ts">
  import type { GrowthBook } from "@growthbook/growthbook";
  import { setContext } from "svelte";
  import { ContextSymbol, type GrowthBookContext } from "./context";
  import { writable } from "svelte/store";

  export let growthbook: GrowthBook | undefined;

  if (!growthbook) {
    console.warn("GrowthBookProvider: GrowthBook instance not provided")
  }

  const growthbookClient = writable<GrowthBook | undefined>(growthbook);
  setContext<GrowthBookContext>(ContextSymbol, { growthbookClient });

  $: growthbookClient.set(growthbook);
</script>

<slot />
