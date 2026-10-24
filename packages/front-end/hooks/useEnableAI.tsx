import { ReactNode, useState } from "react";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import OptInModal from "@/components/License/OptInModal";
import track from "@/services/track";

// Without the AI agreement (Cloud), shows it first; agreeing turns AI on.
export function useEnableAI(source?: string): {
  enableAI: () => Promise<void>;
  optInModal: ReactNode;
} {
  const { aiAgreedTo } = useAISettings();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const [showOptIn, setShowOptIn] = useState(false);

  const enableAI = async () => {
    track("Enable AI Callout Clicked", { source });
    if (!aiAgreedTo) {
      setShowOptIn(true);
      return;
    }
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({ settings: { aiEnabled: true } }),
    });
    await refreshOrganization();
  };

  return {
    enableAI,
    optInModal: showOptIn ? (
      <OptInModal agreement="ai" onClose={() => setShowOptIn(false)} />
    ) : null,
  };
}
