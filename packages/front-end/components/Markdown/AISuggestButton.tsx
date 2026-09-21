import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { AISuggestionType } from "shared/ai";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import OptInModal from "@/components/License/OptInModal";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";

const AI_DISABLED = "AI is disabled for your organization. Adjust in settings.";
const BUTTON_WIDTH = "11rem";

export interface Props {
  /** Returns the suggested text, or an empty string when it has none. */
  suggest: (type: AISuggestionType) => Promise<string>;
  onSuggestion: (suggestion: string) => void;
  label?: string;
  trackingSource?: string;
  disabled?: boolean;
}

/**
 * The "get a suggestion" control, with its premium gate and opt-in, so any
 * editor can offer one without reimplementing the flow.
 */
export default function AISuggestButton({
  suggest,
  onSuggestion,
  label = "Get AI Suggestion",
  trackingSource,
  disabled,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [optIn, setOptIn] = useState(false);

  const run = async () => {
    if (!aiEnabled) {
      setError(AI_DISABLED);
      return;
    }
    track("ai-suggestion", { source: trackingSource, type: "suggest" });
    setError("");
    setLoading(true);
    try {
      const suggestion = await suggest("suggest");
      if (!suggestion) throw new Error("Failed to get AI suggestion");
      onSuggestion(suggestion);
    } catch (e) {
      setError(e.message || "Failed to get AI suggestion. API request error");
    } finally {
      setLoading(false);
    }
  };

  const button = !hasCommercialFeature("ai-suggestions") ? (
    <PremiumTooltip commercialFeature="ai-suggestions">
      <Button
        variant="soft"
        disabled
        style={{ minWidth: BUTTON_WIDTH, justifyContent: "center" }}
      >
        <BsStars /> {label}
      </Button>
    </PremiumTooltip>
  ) : aiAgreedTo && aiEnabled ? (
    <Button
      variant="soft"
      disabled={disabled || loading}
      onClick={run}
      // Fixed, so swapping in "Generating..." does not resize the button.
      style={{ minWidth: BUTTON_WIDTH, justifyContent: "center" }}
    >
      <BsStars /> {loading ? "Generating..." : label}
    </Button>
  ) : (
    <Tooltip body={aiEnabled ? "" : AI_DISABLED}>
      <Button
        variant="soft"
        onClick={() => (aiAgreedTo ? setError(AI_DISABLED) : setOptIn(true))}
        style={{ minWidth: BUTTON_WIDTH, justifyContent: "center" }}
      >
        <BsStars /> {label}
      </Button>
    </Tooltip>
  );

  return (
    <>
      <Flex align="center" gap="2" wrap="wrap">
        {button}
        {error ? (
          <HelperText status="error" size="sm">
            {error}
          </HelperText>
        ) : null}
      </Flex>
      {optIn ? (
        <OptInModal agreement="ai" onClose={() => setOptIn(false)} />
      ) : null}
    </>
  );
}
