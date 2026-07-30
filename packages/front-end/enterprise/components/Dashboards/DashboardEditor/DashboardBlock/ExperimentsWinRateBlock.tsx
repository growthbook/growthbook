import { ExperimentsWinRateBlockInterface } from "shared/enterprise";
import WinRateBlockChart from "./WinRateBlockChart";
import { BlockProps } from ".";

export default function ExperimentsWinRateBlock({
  block,
}: BlockProps<ExperimentsWinRateBlockInterface>) {
  return <WinRateBlockChart block={block} />;
}
