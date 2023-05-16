<script lang="ts">
  import FeaturesReady from "$lib/FeaturesReady.svelte";
  import GrowthBookProvider from "$lib/GrowthBookProvider.svelte";
  import type { GrowthBook } from "@growthbook/growthbook";
  import Fallback from "./Fallback.svelte";
  import FeatureComponent from "./FeatureComponent.svelte";

  export let growthbook: GrowthBook | undefined;
  export let timeout = 0;
</script>

<GrowthBookProvider growthbook={growthbook}>
  <FeaturesReady timeout={timeout}>
    <Fallback slot="fallback" />
    <FeatureComponent slot="primary" />
  </FeaturesReady>
</GrowthBookProvider>