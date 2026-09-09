import { useRouter } from "next/router";
import { useEffect } from "react";

// Mounted globally on pages/metrics.tsx: landing here with ?addMetric=<json>
// (a link crafted externally - docs, support, onboarding, not generated
// anywhere in this repo) used to auto-open FactMetricModal pre-filled from a
// template. The full flow (parse, premium/name-collision gates, fact-table
// field mapping) now lives at /fact-metrics/new, which understands the same
// querystring - this just forwards the request there unchanged.
export default function MetricTemplateRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (typeof router.query.addMetric !== "string") return;
    router.replace(
      `/fact-metrics/new?addMetric=${encodeURIComponent(router.query.addMetric)}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.addMetric]);

  return null;
}
