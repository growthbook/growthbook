import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { DashboardBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { DashboardSettings } from "back-end/src/enterprise/validators/dashboard-instance";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import MarkdownBlock from "./MarkdownBlock";
import MetadataBlock from "./MetadataBlock";
import MetricBlock from "./MetricBlock";
import VariationImageBlock from "./VariationImageBlock";
import DimensionBlock from "./DimensionBlock";
import TimeSeriesBlock from "./TimeSeriesBlock";

interface Props {
  block: DashboardBlockInterface;
  settings: DashboardSettings;
  isEditing: boolean;
  setBlock: (block: DashboardBlockInterface) => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function DashboardBlock({
  block,
  isEditing,
  setBlock,
  experiment,
  mutate,
}: Props) {
  switch (block.type) {
    case "markdown":
      return (
        <MarkdownBlock
          content={block.content}
          isEditing={isEditing}
          setBlock={setBlock}
        />
      );
    case "metadata":
      return (
        <MetadataBlock
          subtype={block.subtype}
          isEditing={isEditing}
          setBlock={setBlock}
          experiment={experiment}
          mutate={mutate}
        />
      );
    case "variation-image":
      return (
        <VariationImageBlock
          variationIds={block.variationIds}
          experiment={experiment}
          isEditing={isEditing}
          setBlock={setBlock}
        />
      );
    case "metric":
      return (
        <MetricBlock
          metricId={block.metricId}
          isEditing={isEditing}
          setBlock={setBlock}
          experiment={experiment}
          variationIds={block.variationIds}
          baselineRow={block.baselineRow}
        />
      );
    case "dimension":
      return (
        <SnapshotProvider experiment={experiment}>
          <DimensionBlock
            dimensionId={block.dimensionId}
            dimensionValues={block.dimensionValues}
            variationIds={block.variationIds}
            metricId={block.metricId}
            isEditing={isEditing}
            setBlock={setBlock}
            experiment={experiment}
            differenceType={block.differenceType}
            baselineRow={block.baselineRow}
          />
        </SnapshotProvider>
      );
    case "time-series":
      return (
        <TimeSeriesBlock
          experiment={experiment}
          metricId={block.metricId}
          variationIds={block.variationIds}
          dateStart={block.dateStart}
          dateEnd={block.dateEnd}
          isEditing={isEditing}
          setBlock={setBlock}
        />
      );
  }
}
