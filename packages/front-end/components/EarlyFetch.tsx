import { useRouter } from "next/router";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getFeaturePagePath, parseVersion } from "@/hooks/useFeaturePageData";

// Rendered while the dashboard waits for /organization. Starts the requests
// that would otherwise wait for it (definitions, and the flag on a flag page)
// so they run in parallel. The hooks that need the data later use the same
// SWR keys and pick up the running request or its result.
export default function EarlyFetch() {
  const { orgId } = useAuth();
  const { pathname, query } = useRouter();
  useApi("/organization/definitions", { shouldRun: () => !!orgId });
  useApi(getFeaturePagePath(query.fid, parseVersion(query.v)), {
    shouldRun: () => !!orgId && pathname === "/features/[fid]" && !!query.fid,
  });
  return null;
}
