import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import useFeaturesSettled from "@/hooks/useFeaturesSettled";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";
import { isExperimentationLeaning } from "@/services/onboarding";
import Callout from "@/ui/Callout";

type FeatureExpUsage = {
  hasFeatures: boolean;
  hasExperiments: boolean;
};

export default function Home(): React.ReactElement {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { organization } = useUser();
  const aiOnboarding = useFeatureIsOn("ai-assisted-onboarding");
  // The redirect below fires once, so it waits for the feature payload.
  const flagsSettled = useFeaturesSettled();

  // Fetch fresh on mount — we don't want a cached "no features yet" result
  // bouncing the user back to /setup right after they create their first one.
  const [data, setData] = useState<FeatureExpUsage | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiCall<FeatureExpUsage>("/organization/feature-exp-usage", {
      method: "GET",
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [apiCall]);

  const hasFeatureOrExperiment = data
    ? data.hasFeatures || data.hasExperiments
    : undefined;

  const willRedirect = hasFeatureOrExperiment === false;

  useEffect(() => {
    if (!organization) return;
    if (!willRedirect) return;
    if (!flagsSettled) return;

    const demographics = organization.demographicData;

    // Whoever chose "engineer" at signup gets the agent-driven setup, when it is on.
    if (
      aiOnboarding &&
      !organization.isVercelIntegration &&
      demographics?.ownerJobTitle === "engineer"
    ) {
      router.replace("/connect");
      return;
    }

    const useNewOnboarding = isExperimentationLeaning(demographics);
    if (!organization.isVercelIntegration && !useNewOnboarding) {
      router.replace("/setup");
    } else {
      router.replace("/getstarted");
    }
  }, [organization, willRedirect, router, flagsSettled, aiOnboarding]);

  if (error) {
    return (
      <Callout status="error">{error.message || "An error occurred"}</Callout>
    );
  }
  if (!data || willRedirect) return <LoadingOverlay />;
  return <GetStartedAndHomePage showMarketingBanner />;
}
