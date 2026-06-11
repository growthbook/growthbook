import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { AssistantBubble } from "@/enterprise/components/AIChat/AIChatPrimitives";
import ToolUsageDetails from "@/enterprise/components/AIChat/ToolUsageDetails";

export interface ConfirmActionPrompt {
  /** Sequential id so a fresh prompt supersedes an older one. */
  seq: number;
  /** Server-issued id for the parked mutation; echoed back on the decision. */
  actionId: string;
  method: string;
  path: string;
  summary: string;
  /** Parsed query params for the parked call, if any. */
  query?: Record<string, unknown>;
  /** Request body for the parked call, if any. */
  body?: unknown;
  /**
   * Once the user decides (or sends another message) the prompt resolves and
   * the card is hidden — the decision plays out in the streamed reply and the
   * persisted "Completed steps", so a lingering card would render out of order.
   */
  resolved: boolean;
}

/** Body fields sent alongside the next message to resolve a parked mutation. */
export interface ConfirmDecisionBody {
  confirmActionId: string;
  confirmDecision: "confirm" | "cancel";
}

/**
 * Renders the human-in-the-loop gate for a parked write: the HTTP method +
 * path, an optional summary and request-details disclosure, and Confirm /
 * Cancel buttons.
 */
export default function ConfirmActionCard({
  prompt,
  loading,
  onDecide,
}: {
  prompt: ConfirmActionPrompt;
  loading: boolean;
  onDecide: (decision: "confirm" | "cancel") => void;
}) {
  return (
    <AssistantBubble>
      <Flex direction="column" gap="2">
        <Text size="small" weight="medium">
          Apply this change?
        </Text>
        <Flex
          align="center"
          gap="2"
          wrap="wrap"
          style={{
            padding: "6px 8px",
            borderRadius: "var(--radius-2)",
            background: "var(--gray-a3)",
          }}
        >
          <MethodPill method={prompt.method} />
          <code
            style={{
              fontSize: 12,
              color: "var(--gray-12)",
              overflowWrap: "anywhere",
            }}
          >
            {prompt.path}
          </code>
        </Flex>
        {prompt.summary &&
          prompt.summary !== `${prompt.method} ${prompt.path}` && (
            <Text size="small" color="text-low">
              {prompt.summary}
            </Text>
          )}
        {(prompt.body !== undefined || prompt.query) && (
          <ToolUsageDetails
            summaryLabel="Request details"
            toolInput={{
              method: prompt.method,
              path: prompt.path,
              ...(prompt.query ? { query: prompt.query } : {}),
              ...(prompt.body !== undefined ? { body: prompt.body } : {}),
            }}
          />
        )}
        <Text size="small" color="text-low">
          This is a write to GrowthBook. Confirm to run it, or cancel to keep it
          from happening.
        </Text>
        <Flex gap="2">
          <Button
            size="xs"
            disabled={loading}
            onClick={() => onDecide("confirm")}
          >
            Confirm
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={loading}
            onClick={() => onDecide("cancel")}
          >
            Cancel
          </Button>
        </Flex>
      </Flex>
    </AssistantBubble>
  );
}

/** HTTP-method color mapping for the gated-call pill. */
const METHOD_COLORS: Record<string, { bg: string; fg: string }> = {
  GET: { bg: "var(--blue-a4)", fg: "var(--blue-11)" },
  POST: { bg: "var(--green-a4)", fg: "var(--green-11)" },
  PUT: { bg: "var(--amber-a4)", fg: "var(--amber-11)" },
  PATCH: { bg: "var(--amber-a4)", fg: "var(--amber-11)" },
  DELETE: { bg: "var(--red-a4)", fg: "var(--red-11)" },
};

/** Small colored badge showing the HTTP method of a gated mutation. */
function MethodPill({ method }: { method: string }) {
  const upper = (method || "").toUpperCase();
  const colors = METHOD_COLORS[upper] ?? {
    bg: "var(--gray-a4)",
    fg: "var(--gray-11)",
  };
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "1px 6px",
        borderRadius: "var(--radius-1)",
        background: colors.bg,
        color: colors.fg,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {upper || "?"}
    </span>
  );
}
