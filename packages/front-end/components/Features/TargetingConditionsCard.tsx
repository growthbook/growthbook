import React from "react";
import { Box, Flex, Separator, Card } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import clsx from "clsx";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export function TargetingConditionsCard({
  targetingType,
  total: _total,
  children,
  addButton,
  advancedToggle,
  className,
  slimMode,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
  children: React.ReactNode;
  addButton?: React.ReactNode;
  advancedToggle?: React.ReactNode;
  className?: string;
  slimMode?: boolean;
}) {
  const content = (
    <Flex
      direction="column"
      gap={slimMode ? "1" : "2"}
      ml={slimMode ? "0" : "1"}
    >
      {!slimMode && (
        <ConditionGroupHeader
          targetingType={targetingType}
          advancedToggle={advancedToggle}
        />
      )}
      <Flex direction="column" gap="4">
        {children}
      </Flex>
      {addButton != null && (
        <Box
          style={{ alignSelf: "flex-start" }}
          pt={slimMode ? "1" : "2"}
          pb="0"
        >
          {addButton}
        </Box>
      )}
    </Flex>
  );

  if (slimMode) {
    return (
      <Box
        className={clsx("gb-condition-group-card", className)}
        p="2"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-2)",
        }}
      >
        {content}
      </Box>
    );
  }

  return (
    <Card
      className={clsx("gb-condition-group-card", className)}
      style={{ contain: "none" }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "4px",
          backgroundColor: "var(--slate-9)",
        }}
      ></div>
      {content}
    </Card>
  );
}

export type ConditionGroupTargetingType =
  | "attribute"
  | "group"
  | "prerequisite";

export function ConditionGroupHeader({
  targetingType,
  advancedToggle,
}: {
  targetingType: ConditionGroupTargetingType;
  advancedToggle?: React.ReactNode;
}) {
  let label: React.ReactNode;
  if (targetingType === "attribute" || targetingType === "group") {
    label = `INCLUDE`;
  } else {
    label = `INCLUDE IF`;
  }

  return (
    <Flex
      className="gb-condition-group-header"
      align="center"
      justify="between"
    >
      <Text size="medium" weight="medium" color="text-mid">
        {label}
      </Text>
      {advancedToggle && <Box>{advancedToggle}</Box>}
    </Flex>
  );
}

// Responsive flex layout: configurable width proportions
export function ConditionRow({
  prefixSlot,
  attributeSlot,
  operatorSlot,
  valueSlot,
  removeSlot,
  widthMode = "default",
}: {
  prefixSlot?: React.ReactNode | null; // null = draw empty slot
  attributeSlot: React.ReactNode;
  operatorSlot?: React.ReactNode | null; // null = draw empty slot
  valueSlot?: React.ReactNode;
  removeSlot?: React.ReactNode | null; // null = draw empty slot
  widthMode?: "default" | "stacked"; // default: 25/25/50. stacked: attribute full-width, then operator/value 50/50
}) {
  const isStacked = widthMode === "stacked";

  if (isStacked) {
    return (
      <Flex direction="column" gap="3" className="gb-condition-row">
        <Flex gap="3" align="start">
          {prefixSlot !== undefined && (
            <Box flexShrink="0" style={{ width: 35 }}>
              <Flex align="center" style={{ height: 38 }}>
                {prefixSlot}
              </Flex>
            </Box>
          )}
          <Box style={{ flex: "1 1 0", minWidth: 0 }}>{attributeSlot}</Box>
          {removeSlot != undefined && (
            <Box flexShrink="0" pt="3">
              {removeSlot}
            </Box>
          )}
        </Flex>
        {(operatorSlot !== undefined || valueSlot !== undefined) && (
          <Flex gap="3" align="start">
            {prefixSlot !== undefined && (
              <Box flexShrink="0" style={{ width: 35 }} />
            )}
            {operatorSlot !== undefined && (
              <Box style={{ minWidth: 150, flex: "1 1 0" }}>{operatorSlot}</Box>
            )}
            {valueSlot !== undefined && (
              <Box style={{ minWidth: 150, flex: "1 1 0" }}>{valueSlot}</Box>
            )}
            {removeSlot !== undefined && (
              <Box flexShrink="0" style={{ width: "var(--space-4)" }} />
            )}
          </Flex>
        )}
      </Flex>
    );
  }

  return (
    <Flex gap="3" align="start" className="gb-condition-row">
      {prefixSlot !== undefined && (
        <Box flexShrink="0" style={{ width: 35 }}>
          <Flex align="center" style={{ height: 38 }}>
            {prefixSlot}
          </Flex>
        </Box>
      )}
      <Flex
        gap="3"
        align="start"
        wrap="wrap"
        style={{ flex: "1 1 0", minWidth: 0 }}
      >
        <Box
          style={{
            minWidth: 150,
            flex: "1 1 0",
          }}
        >
          {attributeSlot}
        </Box>
        {operatorSlot !== undefined && (
          <Box style={{ minWidth: 150, flex: "1 1 0" }}>{operatorSlot}</Box>
        )}
        <Box
          style={{
            minWidth: 300,
            flex:
              operatorSlot !== undefined
                ? "2 1 0"
                : // `2 1 0` would have been grid-aligned, but we need more space for saved group labels ($savedGroups, $notSavedGroups)
                  "1.5 1 0",
          }}
        >
          {valueSlot}
        </Box>
      </Flex>
      {removeSlot !== undefined && (
        <Box flexShrink="0" pt="3">
          {removeSlot}
        </Box>
      )}
    </Flex>
  );
}

export function ConditionRowLabel({ label }: { label: string }) {
  return (
    <Text size="medium" weight="medium" color="text-mid">
      {label}
    </Text>
  );
}

export function ConditionRowHeader({
  label,
  advancedToggle,
}: {
  label: string;
  advancedToggle?: React.ReactNode;
}) {
  return (
    <Flex
      className="gb-condition-row-header"
      align="center"
      justify="between"
      mb="2"
      style={{ minHeight: 24 }}
    >
      <Text size="medium" weight="medium" color="text-mid">
        {label}
      </Text>
      {advancedToggle && <Box>{advancedToggle}</Box>}
    </Flex>
  );
}

export function OrSeparator({ slimMode }: { slimMode?: boolean }) {
  return (
    <Flex
      align="center"
      gap="3"
      my={slimMode ? "2" : "5"}
      className="gb-or-separator"
    >
      <Separator style={{ flexGrow: 1 }} />
      <Text size="medium" weight="medium">
        OR
      </Text>
      <Separator style={{ flexGrow: 1 }} />
    </Flex>
  );
}

export function AddConditionButton({
  onClick,
  children,
  slimMode,
}: {
  onClick: () => void;
  children?: React.ReactNode;
  slimMode?: boolean;
}) {
  return (
    <Link onClick={onClick} className="and-button">
      <Text
        weight={slimMode ? "regular" : "semibold"}
        size={slimMode ? "small" : "medium"}
      >
        <PiPlusBold className="mr-1" />
        {children ?? "Add condition"}
      </Text>
    </Link>
  );
}

export function AddOrGroupButton({
  onClick,
  slimMode,
}: {
  onClick: () => void;
  slimMode?: boolean;
}) {
  return (
    <Box my={slimMode ? "1" : "4"}>
      <Link onClick={onClick} className="or-button">
        <Text
          weight={slimMode ? "regular" : "semibold"}
          size={slimMode ? "small" : "medium"}
        >
          <PiPlusBold className="mr-1" />
          Add OR group
        </Text>
      </Link>
    </Box>
  );
}
