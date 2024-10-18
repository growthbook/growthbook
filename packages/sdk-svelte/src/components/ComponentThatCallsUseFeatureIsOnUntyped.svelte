<script lang="ts">
  import { useFeatureIsOn } from "$lib/useFeatureIsOn";

  const isOn = useFeatureIsOn("bar");

  const text = isOn ? "Yes" : "No";
</script>

<h1>is on = {text}</h1>
