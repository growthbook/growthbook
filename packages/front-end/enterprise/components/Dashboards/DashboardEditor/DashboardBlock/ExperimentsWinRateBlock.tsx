import {
  ExperimentsWinRateBlockInterface,
  getEffectiveExperimentBlock,
} from "shared/enterprise";
import WinRateBlockChart from "./WinRateBlockChart";
import { BlockProps } from ".";

export default function ExperimentsWinRateBlock({
  block: rawBlock,
  dashboardGlobalControls,
}: BlockProps<ExperimentsWinRateBlockInterface>) {
  // Apply any dashboard-wide global filters the block has opted into.
  const block = getEffectiveExperimentBlock(rawBlock, {
    globalControls: dashboardGlobalControls,
  });
  return <WinRateBlockChart block={block} />;
}
