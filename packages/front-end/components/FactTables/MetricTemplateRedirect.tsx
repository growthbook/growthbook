import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";

export default function MetricTemplateRedirect() {
  const router = useRouter();
  const { open, modal } = useFactMetricFlow("metric-template");
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const template = router.query.addMetric;
    if (typeof template !== "string") {
      handled.current = null;
      return;
    }
    if (handled.current === template || !open({ template })) return;
    handled.current = template;
  }, [router, open]);

  return (
    <>
      {modal}
      {typeof router.query.addMetric === "string" &&
      !modal &&
      handled.current !== router.query.addMetric ? (
        <LoadingOverlay />
      ) : null}
    </>
  );
}
