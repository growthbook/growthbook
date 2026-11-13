// Stopping removes the experiment from the SDK payload entirely, so neither
// ranker's config is served. `interleave()` falls back to the caller's
// `fallbackConfig`, which GrowthBook never sees.
export default function StopInterleavingWarning() {
  return (
    <>
      Both rankers stop serving. <code>interleave()</code> falls back to the{" "}
      <code>fallbackConfig</code> in your code. Results stay available.
    </>
  );
}
