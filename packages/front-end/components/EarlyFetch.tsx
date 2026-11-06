import { useRouter } from "next/router";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getFeaturePagePath, parseVersion } from "@/hooks/useFeaturePageData";

// Rendered while the dashboard waits for /organization so the definitions (and
// the flag on a flag page) load in parallel; later hooks share the SWR keys.
export default function EarlyFetch() {
  const { orgId } = useAuth();
  const { pathname, query } = useRouter();
  useApi("/organization/definitions", { shouldRun: () => !!orgId });
  useApi(getFeaturePagePath(query.fid, parseVersion(query.v)), {
    shouldRun: () => !!orgId && pathname === "/features/[fid]" && !!query.fid,
  });
  return null;
}
