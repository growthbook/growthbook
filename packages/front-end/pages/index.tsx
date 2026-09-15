import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import useAgentOnboarding from "@/hooks/useAgentOnboarding";
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
  const agentOnboarding = useAgentOnboarding();
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
  // Set once the agent-driven setup has been offered, so a user who skips it is
  // not sent straight back on their next visit.
  const [stayHere, setStayHere] = useState(false);

  useEffect(() => {
    if (!organization) return;
    if (!willRedirect) return;
    if (!flagsSettled) return;

    const demographics = organization.demographicData;

    // The agent-driven setup is offered once. After that this page is theirs, so
    // skipping it actually sticks.
    if (agentOnboarding) {
      const key = `onboarding:connect-offered:${organization.id}`;
      let offered = false;
      try {
        offered = localStorage.getItem(key) === "1";
      } catch {
        // Storage can be unavailable; offering it again beats a blank page.
      }
      if (offered) {
        setStayHere(true);
        return;
      }
      try {
        localStorage.setItem(key, "1");
      } catch {
        // Same: the redirect still happens, it just repeats next visit.
      }
      router.replace("/connect");
      return;
    }

    const useNewOnboarding = isExperimentationLeaning(demographics);
    if (!organization.isVercelIntegration && !useNewOnboarding) {
      router.replace("/setup");
    } else {
      router.replace("/getstarted");
    }
  }, [organization, willRedirect, router, flagsSettled, agentOnboarding]);

  if (error) {
    return (
      <Callout status="error">{error.message || "An error occurred"}</Callout>
    );
  }
  if (!data || (willRedirect && !stayHere)) return <LoadingOverlay />;
  return <GetStartedAndHomePage showMarketingBanner />;
}
