import { useEffect } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import { getLegacyDashboardRedirect } from "@/components/Insights/legacyDashboardRedirect";

// The Insights dashboard split into Health and Impact; old links still work
export default function LegacyDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (router.isReady) {
      router.replace(getLegacyDashboardRedirect(router.query));
    }
  }, [router]);
  return <LoadingOverlay />;
}
