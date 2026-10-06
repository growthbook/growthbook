import { useState } from "react";
import clsx from "clsx";
import { Box, Flex, TextArea } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { formatAIRateLimitRetryMessage } from "shared/ai";
import { AppFeatures } from "shared/types/app-features";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import track from "@/services/track";
import OptInModal from "@/components/License/OptInModal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "@/components/Comments/PlainCommentBox.module.scss";

// The Setup page's Hypothesis field: a plain text area with "Check
// Hypothesis" inside it, bottom right, like the rail's comment box (set in
// review).
//
// FALLBACK: Radix TextArea, used directly. @/ui/ has no text area component
// (the same fallback as components/Comments/PlainCommentBox). Replaces
// MarkdownInput here, so there's no formatting toolbar or preview; the saved
// text is still rendered as markdown on the read-only page.
//
// "Check Hypothesis" is the product's existing AI check (/ai/reformat, as in
// EditHypothesisModal): it asks for AI consent first if needed, and shows the
// suggestion under the field with Use suggestion / Dismiss.
export default function HypothesisField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const gb = useGrowthBook<AppFeatures>();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const [checking, setChecking] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false);

  async function check() {
    if (!aiAgreedTo) {
      setOptIn(true);
      return;
    }
    if (!aiEnabled) {
      setError("AI is disabled for your organization. Adjust in settings.");
      return;
    }
    setError(null);
    setChecking(true);
    track("ai-suggestion", { source: "experiment-setup-page" });
    try {
      const res = await apiCall<{ data: { output: string } }>(
        "/ai/reformat",
        {
          method: "POST",
          body: JSON.stringify({
            type: "experiment-hypothesis",
            text: value,
            temperature:
              gb?.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1,
          }),
        },
        (responseData) => {
          setError(
            responseData.status === 429
              ? formatAIRateLimitRetryMessage(responseData.retryAfter)
              : responseData.message || "Error getting AI suggestion",
          );
        },
      );
      if (res?.data?.output) setSuggestion(res.data.output);
    } catch {
      // Shown by the error handler above.
    } finally {
      setChecking(false);
    }
  }

  const checkButton = (
    <Button
      size="sm"
      // Ghost, set in review.
      variant="ghost"
      icon={<BsStars />}
      onClick={check}
      loading={checking}
      disabled={!hasAISuggestions}
    >
      Check Hypothesis
    </Button>
  );

  return (
    <Box>
      {optIn ? (
        <OptInModal
          agreement="ai"
          onConfirm={() => {
            setOptIn(false);
            void check();
          }}
          onClose={() => setOptIn(false)}
        />
      ) : null}
      <Box style={{ position: "relative" }}>
        <TextArea
          className={clsx(styles.textArea, styles.hoverOutline)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What do you expect to happen, and why?"
          aria-label="Hypothesis"
          // Fixed height, not resizable; room at the bottom for the button so
          // text never runs under it. Matches the comment box.
          style={{ height: 136, resize: "none", paddingBottom: 36 }}
        />
        {/* Hidden until there's something to check (set in review). */}
        {value.trim() ? (
          <Box
            style={{
              position: "absolute",
              right: "var(--space-2)",
              bottom: "var(--space-2)",
            }}
          >
            {hasAISuggestions ? (
              checkButton
            ) : (
              <Tooltip content="AI suggestions are a premium feature">
                <span>{checkButton}</span>
              </Tooltip>
            )}
          </Box>
        ) : null}
      </Box>
      {error ? (
        <Box mt="1">
          <HelperText status="error">{error}</HelperText>
        </Box>
      ) : null}
      {suggestion ? (
        <Callout status="wizard" mt="3">
          <Text as="div" weight="medium" mb="1">
            Suggested hypothesis
          </Text>
          <Text as="div" whiteSpace="pre-wrap">
            {suggestion}
          </Text>
          <Flex gap="2" mt="3">
            <Button
              size="sm"
              onClick={() => {
                onChange(suggestion);
                setSuggestion(null);
              }}
            >
              Use suggestion
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSuggestion(null)}
            >
              Dismiss
            </Button>
          </Flex>
        </Callout>
      ) : null}
    </Box>
  );
}
