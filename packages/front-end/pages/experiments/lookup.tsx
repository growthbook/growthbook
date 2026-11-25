import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

export default function ExperimentLookupPage() {
  const { t } = useLingui();
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
        setError(e.message || t`An error occurred`);
      });
  }, [trackingKey, apiCall, router, t]);

  if (error) {
    return <Callout status="error">{error}</Callout>;
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      <Callout status="error">
        <Trans>Experiment not found</Trans>
      </Callout>
      <div className="mt-3 px-3">
        <Link href="/experiments" size="lg">
          <Trans>All Experiments</Trans>
        </Link>
      </div>
    </div>
  );
}
