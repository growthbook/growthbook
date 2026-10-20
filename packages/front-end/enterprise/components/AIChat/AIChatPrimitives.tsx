import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCircleNotch,
  PiCheckCircle,
  PiWarningFill,
  PiSparkle,
} from "react-icons/pi";
import Text from "@/ui/Text";
import aiChatStyles from "./AIChatPrimitives.module.scss";

export function AssistantBubble({
  children,
  variant = "message",
}: {
  children: React.ReactNode;
  variant?: "message" | "artifact";
}) {
  return (
    <Box
      style={{
        borderRadius: variant === "artifact" ? "var(--radius-3)" : undefined,
        padding: variant === "artifact" ? "8px 12px 12px" : "2px 0",
        alignSelf: "flex-start",
        width: "min(920px, 100%)",
        maxWidth: "100%",
        minWidth: 0,
        // PROTOTYPE (set in review): an artifact's fill and outline can be
        // set by its container (--ai-artifact-bg, --ai-artifact-border; the
        // GrowthBot drawer on a white panel, AgentPanel.tsx); as before
        // otherwise.
        background:
          variant === "artifact"
            ? "var(--ai-artifact-bg, var(--color-panel-solid))"
            : undefined,
        border:
          variant === "artifact"
            ? "1px solid var(--ai-artifact-border, var(--slate-a5))"
            : undefined,
      }}
      className={aiChatStyles.bubble}
    >
      {children}
    </Box>
  );
}

export function UserBubble({
  children,
  soft = false,
}: {
  children: React.ReactNode;
  /**
   * Opt-in (PROTOTYPE, set in review; the docked agent rail): a soft violet
   * fill with dark text and speech-bubble corners (16px, the bottom right
   * 4px, toward the user's side), so it reads as a message, not a primary
   * button. Without it, as before.
   */
  soft?: boolean;
}) {
  return (
    <Box
      style={{
        borderRadius: soft ? "16px 16px 4px 16px" : "var(--radius-3)",
        padding: "8px 12px",
        maxWidth: "85%",
        alignSelf: "flex-end",
        background: soft ? "var(--violet-a3)" : "var(--violet-10)",
        marginLeft: "auto",
        whiteSpace: "pre-wrap",
      }}
      className={`${aiChatStyles.bubble} ${
        soft ? aiChatStyles.userBubbleSoft : aiChatStyles.userBubble
      }`}
    >
      {children}
    </Box>
  );
}

export function ErrorBubble({ children }: { children: React.ReactNode }) {
  return (
    <Box
      className={aiChatStyles.bubble}
      style={{
        borderRadius: "var(--radius-3)",
        padding: "8px 12px",
        maxWidth: "85%",
        alignSelf: "flex-start",
        background: "var(--red-a3)",
      }}
    >
      {children}
    </Box>
  );
}

export function ThinkingBubble({ label }: { label: string }) {
  return (
    <AssistantBubble>
      <Flex align="center" gap="2">
        <span className={aiChatStyles.spinIcon}>
          <PiCircleNotch size={12} />
        </span>
        <Text size="sm" color="text-low">
          {label}
        </Text>
      </Flex>
    </AssistantBubble>
  );
}

export function InlineLinkLoadingIndicator() {
  return (
    <span
      className={`${aiChatStyles.spinIcon} ${aiChatStyles.inlineLinkLoading}`}
      role="status"
      aria-label="Loading link"
    >
      <PiCircleNotch size={12} />
    </span>
  );
}

export function AIAnalystLabel({
  label = "AI Analyst",
  mb = "1",
}: {
  label?: string;
  mb?: React.ComponentProps<typeof Flex>["mb"];
} = {}) {
  return (
    <Flex align="center" gap="2" mb={mb}>
      <Flex
        align="center"
        justify="center"
        display="inline-flex"
        p="1"
        style={{
          background: "var(--violet-a3)",
          borderRadius: "999px",
        }}
      >
        <PiSparkle size={12} color="var(--violet-11)" />
      </Flex>
      <Text size="sm" weight="medium" color="text-low">
        {label}
      </Text>
    </Flex>
  );
}

export function ToolStatusIcon({
  status,
}: {
  status: "running" | "done" | "error";
}) {
  if (status === "running") {
    return (
      <span className={aiChatStyles.spinIcon}>
        <PiCircleNotch size={12} />
      </span>
    );
  }
  if (status === "error") {
    return <PiWarningFill size={12} color="var(--amber-11)" />;
  }
  return <PiCheckCircle size={12} color="var(--green-9)" />;
}
