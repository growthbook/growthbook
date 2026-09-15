import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useUser } from "@/services/UserContext";

// Whether this organization gets the agent-driven setup at /connect instead of
// the manual wizard: whoever chose "engineer" at signup, when the flag is on.
// Vercel-managed organizations keep their own flow.
export default function useAgentOnboarding(): boolean {
  const { organization } = useUser();
  const enabled = useFeatureIsOn("ai-assisted-onboarding");

  return (
    enabled &&
    !organization?.isVercelIntegration &&
    organization?.demographicData?.ownerJobTitle === "engineer"
  );
}
