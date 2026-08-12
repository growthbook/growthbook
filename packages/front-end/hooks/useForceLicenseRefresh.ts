import { useCallback, useState } from "react";
import { captureException as sentryCaptureException } from "@sentry/nextjs";
import { isSentryEnabled } from "@/services/env";
import { useUser } from "@/services/UserContext";

export type ForceLicenseRefreshStatus = "idle" | "loading" | "failed";

export function useForceLicenseRefresh() {
  const { refreshOrganization } = useUser();
  const [status, setStatus] = useState<ForceLicenseRefreshStatus>("idle");

  const refresh = useCallback(async () => {
    try {
      await refreshOrganization({ forceLicenseRefresh: true });
      setStatus("idle");
    } catch (error) {
      if (isSentryEnabled()) {
        sentryCaptureException(error);
      }
      setStatus("failed");
    }
  }, [refreshOrganization]);

  const retry = useCallback(async () => {
    setStatus("loading");
    await refresh();
  }, [refresh]);

  return { status, refresh, retry };
}
