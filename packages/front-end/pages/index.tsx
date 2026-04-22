import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useUser } from "@/services/UserContext";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";
import { AppFeatures } from "@/types/app-features";
import { isCloud } from "@/services/env";
import useApi from "@/hooks/useApi";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const { data, error } = useApi<{
    hasFeatures: boolean;
    hasExperiments: boolean;
  }>("/organization/feature-exp-usage");

  const { organization } = useUser();
  const gb = useGrowthBook<AppFeatures>();

  const hasFeatureOrExperiment = data
    ? data.hasFeatures || data.hasExperiments
    : undefined;

  const willRedirect = hasFeatureOrExperiment === false;

  useEffect(() => {
    if (!organization) return;
    if (!willRedirect) return;

    const intentToExperiment =
      organization?.demographicData?.ownerUsageIntents?.includes(
        "experiments",
      ) ||
      organization?.demographicData?.ownerUsageIntents?.length === 0 ||
      !organization?.demographicData?.ownerUsageIntents; // If no intents, assume interest in experimentation
    const useNewOnboarding =
      intentToExperiment &&
      isCloud() &&
      gb.isOn("experimentation-focused-onboarding");
    if (!organization.isVercelIntegration && !useNewOnboarding) {
      router.replace("/setup");
    } else {
      router.replace("/getstarted");
    }
  }, [organization, willRedirect, gb, router]);

  if (error) {
    return (
      <div className="alert alert-danger">
        {error.message || "An error occurred"}
      </div>
    );
  }
  if (!data || willRedirect) return <LoadingOverlay />;
  return <GetStartedAndHomePage />;
}
