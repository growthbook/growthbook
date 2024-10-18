<script lang="ts">
  import { useExperiment } from "$lib/useExperiment";

  const { value } = useExperiment({
    key: "my-test",
    variations: [0, 1],
  });
</script>

<h1>{value}</h1>
