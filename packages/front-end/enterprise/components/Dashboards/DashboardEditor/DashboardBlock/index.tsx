import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex } from "@radix-ui/themes";
import { PiTrashFill } from "react-icons/pi";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Button from "@/components/Radix/Button";
import { BLOCK_TYPE_INFO } from "..";
import MarkdownBlock from "./MarkdownBlock";
import DescriptionBlock from "./DescriptionBlock";
import MetricBlock from "./MetricBlock";
import VariationImageBlock from "./VariationImageBlock";
import DimensionBlock from "./DimensionBlock";
import TimeSeriesBlock from "./TimeSeriesBlock";
import HypothesisBlock from "./HypothesisBlock";
import TrafficGraphBlock from "./TrafficGraphBlock";
import TrafficTableBlock from "./TrafficTableBlock";
import SqlExplorerBlock from "./SqlExplorerBlock";

export type BlockProps<
  T extends DashboardBlockInterface
> = DashboardBlockData<T> & {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  isEditing: boolean;
  setBlock: (block: DashboardBlockData<T>) => void;
  ssrPolyfills?: SSRPolyfills;
};

interface Props {
  block: DashboardBlockData<DashboardBlockInterface>;
  isEditing: boolean;
  setBlock: (
    block: DashboardBlockData<DashboardBlockInterface> | undefined
  ) => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

const BLOCK_COMPONENTS: Record<
  DashboardBlockType,
  React.FC<BlockProps<DashboardBlockInterface>>
> = {
  markdown: MarkdownBlock,
  "metadata-description": DescriptionBlock,
  "metadata-hypothesis": HypothesisBlock,
  "variation-image": VariationImageBlock,
  metric: MetricBlock,
  dimension: DimensionBlock,
  "time-series": TimeSeriesBlock,
  "traffic-graph": TrafficGraphBlock,
  "traffic-table": TrafficTableBlock,
  "sql-explorer": SqlExplorerBlock,
};

export default function DashboardBlock({
  block,
  isEditing,
  setBlock,
  experiment,
  mutate,
}: Props) {
  const BlockComponent = BLOCK_COMPONENTS[block.type];
  return (
    <div
      className={
        ["metadata-description", "metadata-hypothesis"].includes(block.type)
          ? ""
          : "appbox p-4"
      }
    >
      {isEditing && (
        <Flex align="center" justify="between">
          <h4 className="text-capitalize">
            {BLOCK_TYPE_INFO[block.type].name}
          </h4>
          <Button
            color="red"
            onClick={() => {
              setBlock(undefined);
            }}
          >
            <PiTrashFill />
          </Button>
        </Flex>
      )}

      <BlockComponent
        {...block}
        isEditing={isEditing}
        setBlock={setBlock}
        experiment={experiment}
        mutate={mutate}
      />
    </div>
  );
}
