<script lang="ts">
  import { useFeature } from "./useFeature";

  export let text: string;
  export let feature: string;

  const value = useFeature(feature).value;
</script>

{#if value}
  {value}
{:else}
  {text}
{/if}
