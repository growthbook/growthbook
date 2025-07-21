import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, Text } from "@radix-ui/themes";
import Callout from "@/components/Radix/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { BLOCK_TYPE_INFO } from "..";

interface BlockErrorStateProps {
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
}

export function BlockNeedsConfiguration({ block }: BlockErrorStateProps) {
  return (
    <Callout status="info">
      This {BLOCK_TYPE_INFO[block.type].name} block requires additional
      configuration to display results.
    </Callout>
  );
}

export function BlockMissingExperiment({ block }: BlockErrorStateProps) {
  return (
    <Callout status="warning">
      Unable to find the experiment this {BLOCK_TYPE_INFO[block.type].name}{" "}
      block was attached to.
    </Callout>
  );
}

export function BlockMissingSavedQuery({ block }: BlockErrorStateProps) {
  return (
    <Callout status="warning">
      Unable to find the Saved Query specified for this{" "}
      {BLOCK_TYPE_INFO[block.type].name} block.
    </Callout>
  );
}

export function BlockMetricsInvalid({ block }: BlockErrorStateProps) {
  return (
    <Callout status="warning">
      Unable to find the metric(s) specified for this{" "}
      {BLOCK_TYPE_INFO[block.type].name} block.
    </Callout>
  );
}

export function BlockLoadingSnapshot() {
  return (
    <Flex align="center" gap="2">
      <LoadingSpinner />
      <Text>Loading data...</Text>
    </Flex>
  );
}

export function BlockMissingData() {
  return (
    <Callout status="info">No data yet. Refresh to populate results.</Callout>
  );
}

export function BlockMissingHealthCheck() {
  return (
    <Callout status="info">
      Unable to load the experiment health check results. Check the Health tab,
      or try refreshing the experiment results.
    </Callout>
  );
}
