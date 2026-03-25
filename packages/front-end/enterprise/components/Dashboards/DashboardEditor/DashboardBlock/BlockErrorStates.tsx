import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
} from "shared/enterprise";
import { Flex, Text } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor";

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

export function BlockObjectMissing({ block }: BlockErrorStateProps) {
  return (
    <Callout status="error">
      Unable to find one or more references specified by this{" "}
      {BLOCK_TYPE_INFO[block.type].name} block. Check the settings for this
      block and ensure that everything is present.
    </Callout>
  );
}

export function BlockRenderError({ block }: BlockErrorStateProps) {
  return (
    <Callout status="error">
      Failed to render this {BLOCK_TYPE_INFO[block.type].name} block. Check the
      settings for this block and ensure everything is present.
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
