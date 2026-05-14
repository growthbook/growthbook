import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

export default function ExperimentLookupPage() {
  const router = useRouter();
  const { trackingKey } = router.query;
  const [error, setError] = useState("");

  const [loading, setLoading] = useState(true);

  const { apiCall } = useAuth();
  useEffect(() => {
    apiCall<{ experimentId: string | null }>(
      `/experiments/tracking-key?trackingKey=${encodeURIComponent(
        trackingKey + "",
      )}`,
      {
        method: "GET",
      },
    )
      .then((res) => {
        if (res.experimentId) {
          router.push(`/experiment/${res.experimentId}`);
        } else {
          setLoading(false);
        }
      })
      .catch((e) => {
        setError(e.message || "An error occurred");
      });
  }, [trackingKey, apiCall, router]);

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents pt-4">
      <Callout status="error">Experiment not found</Callout>
      <div className="mt-3 px-3">
        <Link href="/experiments" size="3">
          All Experiments
        </Link>
      </div>
    </div>
  );
}
