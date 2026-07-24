import { useEffect } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";

// Channel settings moved onto the single Slack page (channel rail + detail
// pane). Redirect old per-channel deep links there, preserving the selection.
const SlackIntegrationDetailRedirect = () => {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const id = Array.isArray(router.query.id)
      ? router.query.id[0]
      : router.query.id;
    router.replace(
      id
        ? `/integrations/slack?channel=${encodeURIComponent(id)}`
        : "/integrations/slack",
    );
  }, [router]);

  return <LoadingOverlay />;
};

export default SlackIntegrationDetailRedirect;
