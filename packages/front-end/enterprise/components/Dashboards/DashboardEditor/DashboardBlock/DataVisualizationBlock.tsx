import { DataVisualizationBlockInterface } from "shared/enterprise";
import { BlockProps } from ".";

// This is where we'll actually render the data visualization for the block. This isn't the component where the user edits the data for the block
export default function DataVisualizationBlock({
  block,
}: BlockProps<DataVisualizationBlockInterface>) {
  return <div>DataVisualizationBlock</div>;
}
