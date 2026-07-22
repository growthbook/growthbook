import { ExperimentsStatusBlockInterface } from "shared/enterprise";
import VelocityBlockChart from "./VelocityBlockChart";
import { BlockProps } from ".";

export default function ExperimentsStatusBlock({
  block,
}: BlockProps<ExperimentsStatusBlockInterface>) {
  const blockId = "id" in block && block.id ? block.id : "new";
  return (
    <VelocityBlockChart
      block={block}
      chartId={`experiments-status-${blockId}`}
    />
  );
}
