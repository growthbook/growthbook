import React from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import Button from "@/ui/Button";

/** Card container for a condition group: renders header, wraps children in a Flex, optionally renders addButton below. */
export function ConditionGroupCard({
  targetingType,
  total,
  extendToCardEdges,
  children,
  addButton,
  style,
  className,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
  /** When true, header extends to card left/right edges. */
  extendToCardEdges?: boolean;
  children: React.ReactNode;
  /** Rendered below the content Flex with anti-stretch wrapper. */
  addButton?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <Flex
      className={["gb-condition-group-card", className]
        .filter(Boolean)
        .join(" ")}
      direction="column"
      gap="4"
      pt="0"
      px="4"
      pb="4"
      style={{
        backgroundColor: "var(--slate-2)",
        border: "1px solid var(--slate-a3)",
        borderRadius: "var(--radius-3)",
        overflow: "hidden",
        ...style,
      }}
    >
      <ConditionGroupHeader
        targetingType={targetingType}
        total={total}
        extendToCardEdges={extendToCardEdges}
      />
      <Flex direction="column" gap="4">
        {children}
      </Flex>
      {addButton != null && (
        <Box style={{ alignSelf: "flex-start" }} pt="2">
          {addButton}
        </Box>
      )}
    </Flex>
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
  extendToCardEdges,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
  /** When true, header extends to card left/right edges (use when Card has horizontal padding). */
  extendToCardEdges?: boolean;
}) {
  let label: React.ReactNode;
  if (targetingType === "attribute") {
    label = `PASS IF`;
  } else if (targetingType === "group") {
    label = `PASS IF`;
  } else {
    label = `PASS IF PREREQUISITE${total > 1 ? "S" : ""} MET`;
  }

  return (
    <Flex
      className="gb-condition-group-header"
      justify="between"
      align="center"
      px="4"
      py="2"
      style={{
        backgroundColor: "var(--slate-3)",
        borderBottom: "1px solid var(--slate-a3)",
        borderRadius: "var(--radius-3) var(--radius-3) 0 0",
        ...(extendToCardEdges && {
          marginLeft: "calc(-1 * var(--space-4))",
          marginRight: "calc(-1 * var(--space-4))",
        }),
      }}
    >
      <Text size="2" style={logicLabelTextStyle}>
        {label}
      </Text>
    </Flex>
  );
}

/** Single condition row: 3-column grid (Attribute, Operator, Value). Optional prefix and remove slots. */
export function ConditionRow({
  prefixSlot,
  attributeSlot,
  operatorSlot,
  valueSlot,
  removeSlot,
}: {
  /** Rendered before attribute; when null, prefix column is skipped. */
  prefixSlot?: React.ReactNode | null;
  attributeSlot: React.ReactNode;
  /** When null, operator column is skipped. */
  operatorSlot?: React.ReactNode | null;
  valueSlot?: React.ReactNode;
  removeSlot?: React.ReactNode;
}) {
  return (
    <Flex
      gap="3"
      align="start"
      className="gb-condition-row"
      style={{
        borderRadius: "var(--radius-2)",
        border: "1px solid transparent",
        minHeight: 40,
      }}
    >
      {prefixSlot !== undefined && (
        <Box flexShrink="0" pt="1" style={{ width: 45, textAlign: "center" }}>
          {prefixSlot}
        </Box>
      )}
      <Box style={{ flex: "0 0 25%", minWidth: 0, maxWidth: "25%" }}>
        {attributeSlot}
      </Box>
      {operatorSlot != undefined && (
        <Box style={{ flex: "0 0 25%", minWidth: 0, maxWidth: "25%" }}>
          {operatorSlot}
        </Box>
      )}
      <Box style={{ flex: "1 1 50%", minWidth: 0 }}>{valueSlot}</Box>
      {removeSlot != undefined && (
        <Box flexShrink="0" style={{ marginLeft: -2, marginRight: -6 }} pt="3">
          {removeSlot}
        </Box>
      )}
    </Flex>
  );
}

const separatorLineStyle = {
  width: "100%" as const,
  borderTop: "1px dashed var(--slate-5)",
};

const logicLabelBoxStyle: React.CSSProperties = {
  background: "var(--surface-background-color)",
  width: 50,
  textAlign: "center",
  border: "1px solid var(--slate-5)",
  borderRadius: "var(--radius-5)",
};

export const logicLabelTextStyle: React.CSSProperties = {
  color: "var(--slate-11)",
  fontFamily: "var(--font-mono)",
  fontWeight: 500,
};

/** Reusable AND/OR label box (background, border, centered text). */
export function LogicLabelBox({ label }: { label: "AND" | "OR" | "IN" }) {
  return (
    <Box py="1" style={logicLabelBoxStyle}>
      <Text size="2" style={logicLabelTextStyle}>
        {label}
      </Text>
    </Box>
  );
}

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
        <LogicLabelBox label="AND" />
      </Flex>
    </Box>
  );
}

/** Horizontal line with "OR" centered (same style as AND). */
export function OrSeparator() {
  return (
    <Box className="gb-or-separator" my="5" style={{ position: "relative" }}>
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
        <LogicLabelBox label="OR" />
      </Flex>
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
