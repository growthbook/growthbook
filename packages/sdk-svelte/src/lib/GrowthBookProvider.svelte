<script lang="ts">
  import type { GrowthBook } from "@growthbook/growthbook";
  import { setContext } from "svelte";
  import { ContextSymbol, type GrowthBookContext } from "./context";

  export let growthbook: GrowthBook | undefined;

  if (!growthbook) {
    console.warn("GrowthBookProvider: GrowthBook instance not provided")
  }

  setContext<GrowthBookContext>(ContextSymbol, { growthbook });
</script>

<slot />
