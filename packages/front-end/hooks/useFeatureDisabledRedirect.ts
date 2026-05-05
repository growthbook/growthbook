import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useEffect } from "react";
import { AppFeatures } from "@/types/app-features";

type UseFeatureDisabledRedirect = {
  ready: boolean;
  shouldRender: boolean;
};

/**
 * Check if an app feature is enabled and redirect if it isn't.
 * @param featureKey
 * @param redirectTo Path to redirect to
 */
export const useFeatureDisabledRedirect = (
  featureKey: keyof AppFeatures,
  redirectTo: string = "/",
): UseFeatureDisabledRedirect => {
  const router = useRouter();
  const growthbook = useGrowthBook<AppFeatures>();

  const shouldRender = growthbook?.isOn(featureKey) || false;
  const ready = growthbook?.ready || false;

  useEffect(
    function redirectIfFeatureDisabled() {
      if (ready && !shouldRender) {
        router.replace(redirectTo);
      }
    },
    [ready, router, shouldRender, redirectTo],
  );

  return {
    ready,
    shouldRender,
  };
};
