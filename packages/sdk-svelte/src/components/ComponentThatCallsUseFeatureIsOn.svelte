<script lang="ts">
  import { useFeatureIsOn } from "$lib/useFeatureIsOn";

  type SampleAppFeatures = {
    foo: number;
    bar: boolean;
    baz: string;
  };

  const isOn = useFeatureIsOn<SampleAppFeatures>("bar");

  const text = isOn ? "Yes" : "No";
</script>

<h1>is on = {text}</h1>
