import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/components/Radix/Link";
import Callout from "@/components/Radix/Callout";
import useApi from "@/hooks/useApi";

export default function HoldoutLookupPage() {
  const router = useRouter();
  const { trackingKey } = router.query;
  const [error, setError] = useState("");

  const path = trackingKey
    ? `/holdout/tracking-key?trackingKey=${encodeURIComponent(trackingKey + "")}`
    : null;
  const {
    data,
    isLoading,
    error: apiError,
  } = useApi<{ holdoutId: string | null }>(path || "", {
    shouldRun: () => !!trackingKey,
  });

  useEffect(() => {
    if (data && data.holdoutId && data.holdoutId !== "not found") {
      router.push(`/holdout/${data.holdoutId}`);
    }
  }, [data, router]);

  useEffect(() => {
    if (apiError) {
      setError(apiError.message || "An error occurred");
    }
  }, [apiError]);

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  if (isLoading) {
    return <LoadingOverlay />;
  }

  // Show different messages based on the response
  if (data) {
    if (data.holdoutId && data.holdoutId !== "not found") {
      // This should redirect, but if we're here, show loading
      return <LoadingOverlay />;
    } else {
      // API returned successfully but no holdout found
      return (
        <div className="container-fluid pagecontents pt-4">
          <Callout status="error">
            No holdout found for tracking key: <code>{trackingKey}</code>
          </Callout>
          <div className="mt-3 px-3">
            <Link href="/holdouts" size="3">
              All Holdouts
            </Link>
          </div>
        </div>
      );
    }
  }

  // If we have an API error, show it
  if (apiError) {
    return (
      <div className="container-fluid pagecontents pt-4">
        <Callout status="error">
          Error looking up holdout: {apiError.message}
        </Callout>
        <div className="mt-3 px-3">
          <Link href="/holdouts" size="3">
            All Holdouts
          </Link>
        </div>
      </div>
    );
  }

  // No data yet, show loading
  return <LoadingOverlay />;
}
