import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { FaAngleLeft } from "react-icons/fa";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function ExperimentLookupPage() {
  const router = useRouter();
  const { trackingKey, data } = router.query;
  const [error, setError] = useState("");
  const { datasources, ready } = useDefinitions();

  const [loading, setLoading] = useState(true);

  const initialValue = useMemo<Partial<ExperimentInterfaceStringDates>>(() => {
    const datasource = datasources[0];
    const defaultData: Partial<ExperimentInterfaceStringDates> = {
      trackingKey: trackingKey + "",
      name: trackingKey + "",
      datasource: datasource?.id,
      exposureQueryId: datasource?.settings?.queries?.exposure?.[0]?.id,
    };

    if (!data) return defaultData;

    try {
      return {
        ...defaultData,
        ...JSON.parse(data + ""),
      };
    } catch (e) {
      return defaultData;
    }
  }, [data, trackingKey, datasources]);

  const { apiCall } = useAuth();
  useEffect(() => {
    apiCall<{ experimentId: string | null }>(
      `/experiments/tracking-key?trackingKey=${encodeURIComponent(
        trackingKey + ""
      )}`,
      {
        method: "GET",
      }
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

  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container p-4">
      <div className="mb-2">
        <Link href="/experiments">
          <a>
            <FaAngleLeft /> All Experiments
          </a>
        </Link>
      </div>
      <NewExperimentForm
        source="tracking-key-deep-link"
        initialValue={initialValue}
        msg="We couldn't find an experiment analysis yet with that id. Create it here instead."
        inline={true}
      />
    </div>
  );
}
