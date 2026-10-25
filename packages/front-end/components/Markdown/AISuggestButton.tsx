import { useState } from "react";
import { BsStars } from "react-icons/bs";
import { AISuggestionType } from "shared/ai";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import OptInModal from "@/components/License/OptInModal";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";

const AI_DISABLED = "AI is disabled for your organization. Adjust in settings.";

export interface Props {
  // Resolves to an empty string when there's no suggestion.
  suggest: (type: AISuggestionType) => Promise<string>;
  onSuggestion: (suggestion: string) => void;
  label?: string;
  trackingSource?: string;
  // Null clears a shown failure.
  onError: (message: string | null) => void;
}

// The "get a suggestion" control with its premium gate and AI opt-in.
export default function AISuggestButton({
  suggest,
  onSuggestion,
  label = "Get AI Suggestion",
  trackingSource,
  onError,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const [loading, setLoading] = useState(false);
  const [optIn, setOptIn] = useState(false);

  const run = async () => {
    if (!aiEnabled) {
      onError(AI_DISABLED);
      return;
    }
    track("ai-suggestion", { source: trackingSource, type: "suggest" });
    onError(null);
    setLoading(true);
    try {
      const suggestion = await suggest("suggest");
      if (!suggestion) throw new Error("Failed to get AI suggestion");
      onSuggestion(suggestion);
    } catch (e) {
      onError(e.message || "Failed to get AI suggestion. API request error");
    } finally {
      setLoading(false);
    }
  };

  const button = !hasCommercialFeature("ai-suggestions") ? (
    <PremiumTooltip commercialFeature="ai-suggestions">
      <Button size="sm" variant="outline" disabled>
        <BsStars /> {label}
      </Button>
    </PremiumTooltip>
  ) : aiAgreedTo && aiEnabled ? (
    <Button size="sm" variant="outline" disabled={loading} onClick={run}>
      <BsStars /> {loading ? "Generating..." : label}
    </Button>
  ) : (
    <Tooltip body={aiEnabled ? "" : AI_DISABLED}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => (aiAgreedTo ? onError(AI_DISABLED) : setOptIn(true))}
      >
        <BsStars /> {label}
      </Button>
    </Tooltip>
  );

  return (
    <>
      {button}
      {optIn ? (
        <OptInModal agreement="ai" onClose={() => setOptIn(false)} />
      ) : null}
    </>
  );
}
