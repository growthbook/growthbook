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

interface AssistantBubbleProps {
  children: React.ReactNode;
  wide?: boolean;
}

export function AssistantBubble({ children, wide }: AssistantBubbleProps) {
  return (
    <Box
      style={{
        borderRadius: "var(--radius-3)",
        padding: "8px 12px",
        alignSelf: "flex-start",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--slate-a5)",
        ...(wide
          ? { width: "min(920px, 100%)", paddingBottom: 12 }
          : { maxWidth: "85%" }),
      }}
      className={aiChatStyles.bubble}
    >
      {children}
    </Box>
  );
}

export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        borderRadius: "var(--radius-3)",
        padding: "8px 12px",
        maxWidth: "85%",
        alignSelf: "flex-end",
        background: "var(--violet-10)",
        marginLeft: "auto",
        whiteSpace: "pre-wrap",
      }}
      className={`${aiChatStyles.bubble} ${aiChatStyles.userBubble}`}
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
      <Text size="small" weight="medium" color="text-low">
        AI Analyst
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
