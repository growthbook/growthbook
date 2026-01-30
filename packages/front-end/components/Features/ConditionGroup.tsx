import React from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import Button from "@/ui/Button";

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--slate-2)",
  borderRadius: "var(--radius-3)",
  boxShadow: "var(--shadow-1)",
  overflow: "hidden",
};

/** White card container for a condition group (rounded, shadow). */
export function ConditionGroupCard({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <Box
      className={["gb-condition-group-card", className]
        .filter(Boolean)
        .join(" ")}
      style={{ ...cardStyle, ...style }}
    >
      {children}
    </Box>
  );
}

export type ConditionGroupTargetingType =
  | "attribute"
  | "group"
  | "prerequisite";

/** Group header strip; label is derived from targeting type and index (attribute) or total (group). */
export function ConditionGroupHeader({
  targetingType,
  total,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
}) {
  let label: React.ReactNode;
  if (targetingType === "attribute") {
    label = `PASS IF`;
  } else if (targetingType === "group") {
    label = `PASS IF IN`;
  } else {
    label = `PASS IF PREREQUISITE${total > 1 ? "S" : ""} MET`;
  }

  return (
    <Flex
      className="gb-condition-group-header"
      justify="between"
      align="center"
      px="4"
      pt="2"
      pb="1"
      style={{
        borderBottom: "1px solid var(--iris-a5)",
        borderRadius: "var(--radius-3) var(--radius-3) 0 0",
        backgroundColor: "var(--iris-a1)",
        margin: "1px 1px 0 1px",
      }}
    >
      <Text size="2" style={logicLabelTextStyle}>
        {label}
      </Text>
    </Flex>
  );
}

/** Content area inside a condition group card (padding, vertical spacing). */
export function ConditionGroupContent({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Box
      className="gb-condition-group-content"
      p="4"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        ...style,
      }}
    >
      {children}
    </Box>
  );
}

/** Single condition row: 3-column grid (Attribute, Operator, Value). Optional labels and remove slot. */
export function ConditionRow({
  attributeSlot,
  operatorSlot,
  valueSlot,
  removeSlot,
}: {
  showLabels?: boolean;
  attributeLabel?: string;
  operatorLabel?: string;
  valueLabel?: string;
  attributeSlot: React.ReactNode;
  operatorSlot: React.ReactNode;
  valueSlot?: React.ReactNode;
  removeSlot?: React.ReactNode;
}) {
  return (
    <Flex
      gap="3"
      align="start"
      style={{
        borderRadius: "var(--radius-2)",
        border: "1px solid transparent",
        minHeight: 40,
      }}
      className="gb-condition-row"
    >
      <Box style={{ flex: "0 0 25%", minWidth: 0, maxWidth: "25%" }}>
        {attributeSlot}
      </Box>
      <Box style={{ flex: "0 0 25%", minWidth: 0, maxWidth: "25%" }}>
        {operatorSlot}
      </Box>
      <Box style={{ flex: "1 1 50%", minWidth: 0 }}>{valueSlot}</Box>
      {removeSlot != null && (
        <Box style={{ flexShrink: 0, marginLeft: -2, marginRight: -6 }} pt="3">
          {removeSlot}
        </Box>
      )}
    </Flex>
  );
}

const separatorLineStyle = {
  width: "100%" as const,
  borderTop: "1px dashed var(--iris-5)",
};

const separatorLabelBoxStyle = {
  background: "var(--iris-3)",
  paddingLeft: "var(--space-3)",
  paddingRight: "var(--space-3)",
  paddingTop: "var(--space-1)",
  paddingBottom: "var(--space-1)",
  border: "1px solid var(--iris-5)",
  borderRadius: "var(--radius-5)",
};

const logicLabelTextStyle = {
  color: "var(--slate-12)",
  fontFamily: "var(--font-mono)",
};

/** Horizontal line with "AND" centered. */
export function AndSeparator() {
  return (
    <Box className="gb-and-separator" py="1" style={{ position: "relative" }}>
      <Box
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Box style={separatorLineStyle} />
      </Box>
      <Flex justify="start" align="start" style={{ position: "relative" }}>
        <Box style={separatorLabelBoxStyle}>
          <Text size="2" style={logicLabelTextStyle}>
            AND
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}

/** Horizontal line with "OR" centered (same style as AND). */
export function OrSeparator() {
  return (
    <Box
      className="gb-or-separator"
      my="4"
      py="2"
      style={{ position: "relative" }}
    >
      <Box
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Box style={separatorLineStyle} />
      </Box>
      <Flex justify="start" style={{ position: "relative" }}>
        <Box style={separatorLabelBoxStyle}>
          <Text size="2" style={logicLabelTextStyle}>
            OR
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}

/** Wrapper for add buttons so they don't stretch (flex) and align with condition rows. */
export function AddConditionButtonWrap({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box
      className="gb-add-condition-button-wrap"
      style={{
        alignSelf: "flex-start",
        paddingTop: "var(--space-2)",
        paddingBottom: "var(--space-2)",
        paddingLeft: 0,
        paddingRight: 0,
      }}
    >
      {children}
    </Box>
  );
}

/** Button with plus icon; default label "+ Add condition". */
export function AddConditionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Button
      className="gb-add-condition-button"
      variant="outline"
      size="sm"
      onClick={onClick}
      icon={<PiPlusBold size={16} />}
    >
      {children ?? "Add condition"}
    </Button>
  );
}

/** Button with plus icon and "+ Add OR group" text. */
export function AddOrGroupButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      className="gb-add-or-group-button"
      variant="outline"
      size="sm"
      onClick={onClick}
      icon={<PiPlusBold size={16} />}
      my="5"
    >
      Add OR group
    </Button>
  );
}
