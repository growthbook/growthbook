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
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
  children: React.ReactNode;
  addButton?: React.ReactNode;
  advancedToggle?: React.ReactNode;
  className?: string;
}) {
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
      <Flex direction="column" gap="2" ml="1">
        <ConditionGroupHeader
          targetingType={targetingType}
          advancedToggle={advancedToggle}
        />
        <Flex direction="column" gap="4">
          {children}
        </Flex>
        {addButton != null && (
          <Box style={{ alignSelf: "flex-start" }} pt="2" pb="0">
            {addButton}
          </Box>
        )}
      </Flex>
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
                  "1.67 1 0",
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

export function OrSeparator() {
  return (
    <Flex align="center" gap="3" my="5" className="gb-or-separator">
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
}: {
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Link onClick={onClick} className="and-button">
      <Text weight="semibold">
        <PiPlusBold className="mr-1" />
        {children ?? "Add condition"}
      </Text>
    </Link>
  );
}

export function AddOrGroupButton({ onClick }: { onClick: () => void }) {
  return (
    <Box my="4">
      <Link onClick={onClick} className="or-button">
        <Text weight="semibold">
          <PiPlusBold className="mr-1" />
          Add OR group
        </Text>
      </Link>
    </Box>
  );
}
