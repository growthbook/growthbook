<script lang="ts">
  import { useFeatureValue } from "$lib/useFeatureValue";

  const val = useFeatureValue("feature", "inline fallback");
</script>

<div>
  {val}
</div>
