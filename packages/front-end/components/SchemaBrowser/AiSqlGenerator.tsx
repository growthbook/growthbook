import { useState, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { BsStars } from "react-icons/bs";
import { FiChevronRight } from "react-icons/fi";
import { formatAIRateLimitRetryMessage } from "shared/ai";
import { AppFeatures } from "shared/types/app-features";
import Field from "@/components/Forms/Field";
import OptInModal from "@/components/License/OptInModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";

type AiSqlGeneratorControls = {
  isOpen: boolean;
  prompt: ReactNode;
  trigger: ReactNode;
};

export default function AiSqlGenerator({
  children,
  datasourceId,
  onAgreementModalOpenChange,
  onLoadingChange,
  onOpenChange,
  onSqlGenerated,
}: {
  children: (controls: AiSqlGeneratorControls) => ReactNode;
  datasourceId: string;
  onAgreementModalOpenChange?: (open: boolean) => void;
  onLoadingChange?: (loading: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onSqlGenerated: (sql: string) => void;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const gb = useGrowthBook<AppFeatures>();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);

  const updateLoading = (value: boolean) => {
    setLoading(value);
    onLoadingChange?.(value);
  };

  const openAgreementModal = () => {
    setAgreementModalOpen(true);
    setTimeout(() => {
      onAgreementModalOpenChange?.(true);
    }, 0);
  };

  const generateSql = async () => {
    if (!aiAgreedTo) {
      openAgreementModal();
      return;
    }
    if (!aiEnabled) {
      setError("AI is disabled for your organization. Adjust in settings.");
      return;
    }

    const temperature =
      gb?.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1;
    track("ai-suggestion", { source: "sql-explorer", type: "suggest" });
    setError(null);
    updateLoading(true);
    apiCall(
      "/saved-queries/generateSQL",
      {
        method: "POST",
        body: JSON.stringify({
          input,
          datasourceId,
          temperature,
        }),
      },
      (responseData) => {
        if (responseData.status === 429) {
          setError(formatAIRateLimitRetryMessage(responseData.retryAfter));
        } else if (responseData.message) {
          setError("Error getting AI suggestion: " + responseData.message);
          throw new Error(responseData.message);
        } else {
          setError("Error getting AI suggestion");
        }
        updateLoading(false);
      },
    )
      .then((res: { data: { sql: string; errors: string[] } }) => {
        onSqlGenerated(res.data.sql);
        if (res.data.errors?.length) {
          setError(res.data.errors.join(", "));
        }
      })
      .catch(() => {
        // Error handling is done by the apiCall errorHandler
      })
      .finally(() => {
        updateLoading(false);
      });
  };

  const handleTriggerClick = () => {
    if (!hasCommercialFeature("ai-suggestions")) {
      throw new Error(
        "AI suggestions are not enabled for your organization. Please contact your administrator.",
      );
    }
    if (!aiAgreedTo) {
      openAgreementModal();
    }
    if (!aiEnabled) {
      throw new Error(
        "AI suggestions are disabled for your organization. Please contact your administrator.",
      );
    }

    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);
    onOpenChange?.(nextIsOpen);
  };

  const trigger = (
    <Tooltip
      body={
        aiEnabled ? (
          ""
        ) : (
          <>
            Org admins can enable AI powered SQL generation in{" "}
            <strong>General Settings</strong>.
          </>
        )
      }
    >
      <Button
        size="xs"
        variant="ghost"
        color="violet"
        onClick={handleTriggerClick}
      >
        <BsStars /> Generate Query
        <FiChevronRight
          className="ml-2"
          style={{
            transform: isOpen ? "rotate(90deg)" : "none",
          }}
        />
      </Button>
    </Tooltip>
  );

  const prompt = isOpen ? (
    <Flex>
      <Box width="100%" px="4" py="3" pb="4">
        <Box pb="3">
          <label>
            Natural language to SQL{" "}
            <Tooltip body="Use text to describe what you would like to generate. The AI is aware of your table structure, but may still hallucinate, particularly with dates." />
          </label>
          <Field
            textarea
            value={input}
            placeholder="Make a request, e.g. 'Show me the top 10 users by revenue in the last month.'"
            onChange={(event) => setInput(event.target.value)}
          />
        </Box>
        <Flex align="center" justify="start" gap="4">
          <Button onClick={generateSql} disabled={loading || !input}>
            <BsStars /> {loading ? "Generating..." : "Generate SQL"}
          </Button>
        </Flex>
        {error && (
          <Box className="text-danger" style={{ padding: "8px" }}>
            {error}
          </Box>
        )}
      </Box>
    </Flex>
  ) : null;

  return (
    <>
      {children({ isOpen, prompt, trigger })}
      {agreementModalOpen && (
        <OptInModal
          agreement="ai"
          onClose={() => {
            onAgreementModalOpenChange?.(false);
            setAgreementModalOpen(false);
          }}
        />
      )}
    </>
  );
}
