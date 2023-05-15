<script lang="ts">
  import { useFeature } from "./useFeature";

  export let feature: string;
</script>

{#if useFeature(feature).on}
  <slot />
{/if}
