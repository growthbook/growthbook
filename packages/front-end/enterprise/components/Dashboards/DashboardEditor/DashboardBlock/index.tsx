import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, Text } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import clsx from "clsx";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
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

export type BlockProps<T extends DashboardBlockInterface> = {
  block: DashboardBlockData<T>;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
};

interface Props {
  block: DashboardBlockData<DashboardBlockInterface>;
  isEditing: boolean;
  editingBlock: boolean;
  disableBlock: boolean;
  editBlock: () => void;
  deleteBlock: () => void;
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
  experiment,
  isEditing,
  editingBlock,
  disableBlock,
  editBlock,
  deleteBlock,
  mutate,
}: Props) {
  const BlockComponent = BLOCK_COMPONENTS[block.type];
  return (
    <div
      className={clsx("appbox p-4", {
        "border-violet": editingBlock,
        "dashboard-disabled": disableBlock,
      })}
    >
      <Flex align="center" justify="between">
        <h4>{block.title}</h4>
        {isEditing && (
          <div>
            {editingBlock ? (
              <Text color="gray">Editing</Text>
            ) : (
              <DropdownMenu
                trigger={
                  <Button
                    icon={<PiCaretDown />}
                    iconPosition="right"
                    variant="ghost"
                    size="xs"
                  >
                    Edit
                  </Button>
                }
              >
                <DropdownMenuItem onClick={editBlock}>
                  Edit Contents
                </DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={deleteBlock}>
                  <Text color="red">Delete</Text>
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        )}
      </Flex>

      <BlockComponent
        block={block}
        isEditing={isEditing}
        experiment={experiment}
        mutate={mutate}
      />
    </div>
  );
}
