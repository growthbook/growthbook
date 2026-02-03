import React from "react";
import { Box, Flex, Text, Separator, Card } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import clsx from "clsx";
import Link from "@/ui/Link";

export function TargetingConditionsCard({
  targetingType,
  total,
  children,
  addButton,
  className,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
  children: React.ReactNode;
  addButton?: React.ReactNode;
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
        <ConditionGroupHeader targetingType={targetingType} total={total} />
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
  total,
}: {
  targetingType: ConditionGroupTargetingType;
  total: number;
}) {
  let label: React.ReactNode;
  if (targetingType === "attribute") {
    label = `INCLUDE IF`;
  } else if (targetingType === "group") {
    label = `INCLUDE IF IN`;
  } else {
    label = `INCLUDE IF`;
  }

  return (
    <Flex
      className="gb-condition-group-header"
      align="center"
    >
      <Text size="2" weight="medium" style={{ color: "var(--color-text-mid)" }}>
        {label}
      </Text>
    </Flex>
  );
}

// Responsive flex layout: 25%/25%/50% proportions
export function ConditionRow({
  prefixSlot,
  attributeSlot,
  operatorSlot,
  valueSlot,
  removeSlot,
}: {
  prefixSlot?: React.ReactNode | null; // null = draw empty slot
  attributeSlot: React.ReactNode;
  operatorSlot?: React.ReactNode | null; // null = draw empty slot
  valueSlot?: React.ReactNode;
  removeSlot?: React.ReactNode | null; // null = draw empty slot
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
        <Box flexShrink="0" style={{ width: 30 }}>
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
        <Box style={{ minWidth: 150, flex: "1 1 0" }}>{attributeSlot}</Box>
        {operatorSlot != undefined && (
          <Box style={{ minWidth: 150, flex: "1 1 0" }}>{operatorSlot}</Box>
        )}
        <Box style={{ minWidth: 300, flex: "2 1 0" }}>{valueSlot}</Box>
      </Flex>
      {removeSlot != undefined && (
        <Box flexShrink="0" pt="3">
          {removeSlot}
        </Box>
      )}
    </Flex>
  );
}

export function ConditionRowLabel({ label }: { label: string }) {
  return (
    <Text size="2" weight="medium" style={{ color: "var(--color-text-mid)" }}>
      {label}
    </Text>
  );
}

export function OrSeparator() {
  return (
    <Flex align="center" gap="3" my="5" className="gb-or-separator">
      <Separator style={{ flexGrow: 1 }} />
      <Text size="2" weight="medium">
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
    <Link onClick={onClick}>
      <Text weight="bold">
        <PiPlusBold className="mr-1" />
        {children ?? "Add condition"}
      </Text>
    </Link>
  );
}

export function AddOrGroupButton({ onClick }: { onClick: () => void }) {
  return (
    <Box my="4">
      <Link onClick={onClick}>
        <Text weight="bold">
          <PiPlusBold className="mr-1" />
          Add OR group
        </Text>
      </Link>
    </Box>
  );
}
