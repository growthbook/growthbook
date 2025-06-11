import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { DashboardBlockData } from "back-end/src/enterprise/models/DashboardBlockModel";
import { DashboardBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import SnapshotProvider from "@/components/Experiment/SnapshotProvider";
import MarkdownBlock from "./MarkdownBlock";
import MetadataBlock from "./MetadataBlock";
import MetricBlock from "./MetricBlock";
import VariationImageBlock from "./VariationImageBlock";
import DimensionBlock from "./DimensionBlock";
import TimeSeriesBlock from "./TimeSeriesBlock";

export type BlockProps<
  T extends DashboardBlockInterface
> = DashboardBlockData<T> & {
  isEditing: boolean;
  setBlock: (block: DashboardBlockData<T>) => void;
};

export type withExperiment<T> = T & {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
};

interface Props {
  block: DashboardBlockData<DashboardBlockInterface>;
  isEditing: boolean;
  setBlock: (block: DashboardBlockData<DashboardBlockInterface>) => void;
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
        <MarkdownBlock {...block} isEditing={isEditing} setBlock={setBlock} />
      );
    case "metadata":
      return (
        <MetadataBlock
          {...block}
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
          {...block}
          isEditing={isEditing}
          setBlock={setBlock}
          experiment={experiment}
          mutate={mutate}
        />
      );
    case "dimension":
      return (
        <SnapshotProvider experiment={experiment}>
          <DimensionBlock
            {...block}
            isEditing={isEditing}
            setBlock={setBlock}
            experiment={experiment}
            mutate={mutate}
          />
        </SnapshotProvider>
      );
    case "time-series":
      return (
        <TimeSeriesBlock
          {...block}
          experiment={experiment}
          mutate={mutate}
          isEditing={isEditing}
          setBlock={setBlock}
        />
      );
  }
}
