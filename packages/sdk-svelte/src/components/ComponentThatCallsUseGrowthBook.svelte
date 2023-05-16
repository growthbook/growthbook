<script lang="ts">
  import { useGrowthBook } from "$lib/useGrowthBook";

  const growthbook = useGrowthBook();

  const fooValue = growthbook?.getFeatureValue("foo", -1);
  const barValue = growthbook?.getFeatureValue("bar", false);
  const bazValue = growthbook?.getFeatureValue("baz", "??");
</script>

<h1>
  foo: {fooValue}, bar: {barValue ? "true" : "false"}, baz: {bazValue}
</h1>
