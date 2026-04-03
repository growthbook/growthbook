import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCircleNotch,
  PiCheckCircle,
  PiWarningFill,
  PiSparkle,
} from "react-icons/pi";
import Text from "@/ui/Text";
// spinIcon is kept here because CSS keyframe animations cannot be done inline.
import aiChatStyles from "./AIChatPrimitives.module.scss";

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const ASSISTANT_BUBBLE_STYLE: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "var(--color-panel-solid)",
  borderRadius: "var(--radius-3)",
  border: "1px solid var(--slate-a5)",
  padding: "8px 12px",
  maxWidth: "85%",
  wordBreak: "break-word",
};

const USER_BUBBLE_STYLE: React.CSSProperties = {
  alignSelf: "flex-end",
  background: "var(--violet-10)",
  borderRadius: "var(--radius-3)",
  padding: "8px 12px",
  maxWidth: "85%",
  marginLeft: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface AssistantBubbleProps {
  children: React.ReactNode;
  /** Expands to fill wider content like charts instead of capping at 85% */
  wide?: boolean;
}

export function AssistantBubble({ children, wide }: AssistantBubbleProps) {
  const style: React.CSSProperties = wide
    ? {
        ...ASSISTANT_BUBBLE_STYLE,
        width: "min(920px, 100%)",
        maxWidth: undefined,
        paddingBottom: 12,
      }
    : ASSISTANT_BUBBLE_STYLE;
  return <Box style={style}>{children}</Box>;
}

interface UserBubbleProps {
  children: React.ReactNode;
}

export function UserBubble({ children }: UserBubbleProps) {
  return (
    <Box style={USER_BUBBLE_STYLE} className={aiChatStyles.userBubble}>
      {children}
    </Box>
  );
}

interface ErrorBubbleProps {
  children: React.ReactNode;
}

export function ErrorBubble({ children }: ErrorBubbleProps) {
  return (
    <Box
      style={{
        alignSelf: "flex-start",
        background: "var(--red-a3)",
        borderRadius: "var(--radius-3)",
        padding: "8px 12px",
        maxWidth: "85%",
      }}
    >
      {children}
    </Box>
  );
}

interface ThinkingBubbleProps {
  label: string;
}

export function ThinkingBubble({ label }: ThinkingBubbleProps) {
  return (
    <AssistantBubble>
      <Flex align="center" gap="2">
        <span className={aiChatStyles.spinIcon}>
          <PiCircleNotch size={12} />
        </span>
        <Text size="small" color="text-low">
          {label}
        </Text>
      </Flex>
    </AssistantBubble>
  );
}

export function AIAnalystLabel() {
  return (
    <Flex align="center" gap="2" mb="1">
      <Box
        style={{
          background: "var(--violet-a3)",
          borderRadius: "999px",
          padding: "5px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PiSparkle size={12} color="var(--violet-11)" />
      </Box>
      <Text size="small" weight="medium" color="text-low">
        AI Analyst
      </Text>
    </Flex>
  );
}

interface ToolStatusIconProps {
  status: "running" | "done" | "error";
}

export function ToolStatusIcon({ status }: ToolStatusIconProps) {
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
