import { useUser } from "@/services/UserContext";

// Whether this organization gets the agent-driven setup at /connect instead of
// the manual wizard: whoever chose "engineer" at signup.
// Vercel-managed organizations keep their own flow.
export default function useAgentOnboarding(): boolean {
  const { organization } = useUser();

  return (
    !organization?.isVercelIntegration &&
    organization?.demographicData?.ownerJobTitle === "engineer"
  );
}
