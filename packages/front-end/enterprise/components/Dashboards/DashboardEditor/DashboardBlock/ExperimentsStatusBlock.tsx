import {
  ExperimentsStatusBlockInterface,
  getEffectiveExperimentBlock,
} from "shared/enterprise";
import VelocityBlockChart from "./VelocityBlockChart";
import { BlockProps } from ".";

export default function ExperimentsStatusBlock({
  block: rawBlock,
  dashboardGlobalControls,
}: BlockProps<ExperimentsStatusBlockInterface>) {
  const blockId = "id" in rawBlock && rawBlock.id ? rawBlock.id : "new";
  // Apply any dashboard-wide global filters the block has opted into (date
  // range, granularity, projects, experiment search).
  const block = getEffectiveExperimentBlock(rawBlock, {
    globalControls: dashboardGlobalControls,
  });
  return (
    <VelocityBlockChart
      block={block}
      chartId={`experiments-status-${blockId}`}
    />
  );
}
