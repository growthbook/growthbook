<script lang="ts">
  import { useGrowthBook } from "$lib/useGrowthBook";

  type SampleAppFeatures = {
    foo: number;
    bar: boolean;
    baz: string;
  };

  const growthbook = useGrowthBook<SampleAppFeatures>();

  const fooValue = growthbook?.getFeatureValue("foo", -1);
  const barValue = growthbook?.getFeatureValue("bar", false);
  const bazValue = growthbook?.getFeatureValue("baz", "??");
</script>

<h1>
  foo: {fooValue}, bar: {barValue ? "true" : "false"}, baz: {bazValue}
</h1>
