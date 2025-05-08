import React, { useEffect, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp, PiDotsSixVertical } from "react-icons/pi";
import clsx from "clsx";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
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

export type BlockProps<T extends DashboardBlockInterface> = {
  block: DashboardBlockInterfaceOrData<T>;
  setBlock: React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
};

interface Props {
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  experiment: ExperimentInterfaceStringDates;
  isEditing: boolean;
  editingBlock: boolean;
  disableBlock: boolean;
  isFirstBlock: boolean;
  isLastBlock: boolean;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
  editBlock: () => void;
  duplicateBlock: () => void;
  deleteBlock: () => void;
  moveBlock: (direction: 1 | -1) => void;
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
  isFirstBlock,
  isLastBlock,
  setBlock,
  editBlock,
  duplicateBlock,
  deleteBlock,
  moveBlock,
  mutate,
}: Props) {
  const [moveBlockOpen, setMoveBlockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const BlockComponent = BLOCK_COMPONENTS[block.type];
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBlock = () => {
    if (scrollRef.current) {
      window.scrollTo(0, scrollRef.current.offsetTop + 250);
    }
  };
  useEffect(() => {
    if (editingBlock) scrollToBlock();
  }, [editingBlock]);

  return (
    <Flex
      ref={scrollRef}
      className={clsx("appbox px-4 py-3 position-relative", {
        "border-violet": editingBlock,
        "dashboard-disabled": disableBlock,
      })}
      direction="column"
    >
      {isEditing && (
        <DropdownMenu
          open={moveBlockOpen}
          onOpenChange={setMoveBlockOpen}
          disabled={disableBlock}
          trigger={
            <IconButton
              className="position-absolute"
              style={{
                top: 20,
                left: 6,
              }}
              variant="ghost"
            >
              <PiDotsSixVertical />
            </IconButton>
          }
        >
          <DropdownMenuItem
            disabled={isFirstBlock}
            onClick={() => {
              moveBlock(-1);
              setMoveBlockOpen(false);
            }}
          >
            <Text>
              <PiCaretUp /> Move up
            </Text>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLastBlock}
            onClick={() => {
              moveBlock(1);
              setMoveBlockOpen(false);
            }}
          >
            <Text>
              <PiCaretDown /> Move down
            </Text>
          </DropdownMenuItem>
        </DropdownMenu>
      )}
      <Flex align="center" justify="between">
        <h4 style={{ margin: 0 }}>
          {BLOCK_TYPE_INFO[block.type].hideTitle
            ? null
            : block.title
            ? block.title
            : isEditing
            ? BLOCK_TYPE_INFO[block.type].name
            : ""}
        </h4>

        {isEditing && (
          <div>
            {editingBlock ? (
              <Text size="1" color="gray">
                Editing
              </Text>
            ) : (
              <DropdownMenu
                open={editOpen}
                onOpenChange={setEditOpen}
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
                <DropdownMenuItem
                  onClick={() => {
                    editBlock();
                    setEditOpen(false);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    duplicateBlock();
                    setEditOpen(false);
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    deleteBlock();
                    setEditOpen(false);
                  }}
                >
                  <Text color="red">Delete</Text>
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        )}
      </Flex>
      <Text>{block.description}</Text>

      <BlockComponent
        block={block}
        setBlock={setBlock}
        isEditing={isEditing}
        experiment={experiment}
        mutate={mutate}
      />
    </Flex>
  );
}
