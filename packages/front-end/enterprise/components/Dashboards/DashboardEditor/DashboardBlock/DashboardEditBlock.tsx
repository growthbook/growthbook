import React, { useEffect, useRef, useState } from "react";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardBlockType,
  blockUsesDashboardDateControl,
  DashboardInterface,
  isDashboardGlobalControlSupportedBlock,
  isDashboardExperimentBlock,
  experimentBlockOptedOutOfGlobalFilters,
} from "shared/enterprise";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiDotsSixVertical, PiPencilSimpleFill } from "react-icons/pi";
import clsx from "clsx";
import { BsThreeDotsVertical } from "react-icons/bs";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import Field from "@/components/Forms/Field";
import Badge from "@/ui/Badge";
import { DashboardBlockTypeMenuItems } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlockTypeMenu";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor/dashboardBlockTypes";
import DashboardBlockContent from "./DashboardBlockContent";

interface Props<DashboardBlock extends DashboardBlockInterface> {
  isTabActive: boolean;
  block: DashboardBlockInterfaceOrData<DashboardBlock>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  blockIndex?: number;
  isFocused: boolean;
  editingBlock: boolean;
  canMoveBlock: boolean;
  disableBlock: "full" | "partial" | "none";
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  setBlock:
    | undefined
    | React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlock>>;
  editBlock: () => void;
  duplicateBlock: () => void;
  deleteBlock: () => void;
  addBlockBefore?: (bType: DashboardBlockType) => void;
  addBlockAfter?: (bType: DashboardBlockType) => void;
  isGeneralDashboard: boolean;
}

export default function DashboardEditBlock<T extends DashboardBlockInterface>({
  isTabActive,
  block,
  dashboardGlobalControls,
  dashboardComparison,
  blockIndex,
  isFocused,
  editingBlock,
  canMoveBlock,
  disableBlock,
  scrollAreaRef,
  setBlock,
  editBlock,
  duplicateBlock,
  deleteBlock,
  addBlockBefore,
  addBlockAfter,
  isGeneralDashboard,
}: Props<T>) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const shouldShowGlobalControlOptOutBadge =
    Boolean(dashboardGlobalControls?.dateRange) &&
    isDashboardGlobalControlSupportedBlock(block) &&
    !blockUsesDashboardDateControl(block);
  // Experiment blocks follow the dashboard's experiment filters via a single
  // per-block toggle; surface a badge when a block has opted out while the
  // dashboard has active filters it could follow.
  const shouldShowExperimentFilterOptOutBadge =
    isDashboardExperimentBlock(block) &&
    experimentBlockOptedOutOfGlobalFilters(block, dashboardGlobalControls);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBlock = () => {
    if (!scrollRef.current || !scrollAreaRef?.current) return;
    // react-grid-layout positions every block via `position: absolute` +
    // `transform: translate(...)`, leaving `offsetTop` at 0. Use rect math
    // against the current scroll position so we land on the block regardless
    // of how RGL positions it.
    const blockRect = scrollRef.current.getBoundingClientRect();
    const scrollRect = scrollAreaRef.current.getBoundingClientRect();
    const top =
      scrollAreaRef.current.scrollTop + (blockRect.top - scrollRect.top);
    scrollAreaRef.current.scrollTo({
      left: 0,
      top,
      behavior: "smooth",
    });
  };
  useEffect(() => {
    if (editingBlock || isFocused) setTimeout(() => scrollToBlock(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBlock, isFocused]);

  const canEditTitle = disableBlock === "none" && !isFocused;
  function getDefaultValueForTitle(
    blockType: DashboardBlockInterface["type"],
  ): string {
    return blockType === "markdown" ? "" : BLOCK_TYPE_INFO[blockType].name;
  }

  return (
    <Flex
      ref={scrollRef}
      className={clsx(
        "appbox dashboard-block px-4 py-3 mb-0 position-relative",
        {
          "border-violet": editingBlock || isFocused,
          "dashboard-disabled": disableBlock === "full",
        },
      )}
      style={{ overflow: "auto", height: "100%", width: "100%" }}
      direction="column"
    >
      {!editingBlock && disableBlock === "none" && (
        <div
          style={{
            position: "absolute",
            top: 45,
            left: 24,
            right: 24,
            bottom: 12,
            backgroundColor:
              "color-mix(in srgb, var(--violet-a3) 30%, transparent)",
            cursor: "pointer",
            // This will make the underlying block non-interactive
            // The user must click this overlay to enter editing mode and then they can interact
            opacity: 0.01,
            zIndex: 999,
            borderRadius: 6,
          }}
          className="fade-hover"
          onClick={(e) => {
            e.stopPropagation();
            editBlock();
          }}
        ></div>
      )}
      <Flex align="center" mb="2">
        {canMoveBlock && disableBlock !== "full" && (
          <IconButton
            className="dashboard-block-drag-handle"
            variant="ghost"
            size="1"
            mr="2"
            aria-label="Drag to reorder block"
            // Only swallow click (which would otherwise toggle title edit) -
            // mousedown must bubble to RGL so the drag actually starts.
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: "grab", touchAction: "none" }}
          >
            <PiDotsSixVertical />
          </IconButton>
        )}
        {canEditTitle && editTitle && setBlock ? (
          <Field
            autoFocus
            defaultValue={block.title || getDefaultValueForTitle(block.type)}
            placeholder="Title"
            onFocus={(e) => {
              e.target.select();
            }}
            onBlur={(e) => {
              setEditTitle(false);
              const title = e.target.value;
              if (title !== block.title) {
                setBlock({ ...block, title });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setEditTitle(false);
              }
            }}
            containerClassName="flex-1"
          />
        ) : (
          <>
            <h4
              onDoubleClick={
                canEditTitle
                  ? (e) => {
                      e.preventDefault();
                      setEditTitle(true);
                    }
                  : undefined
              }
              style={{
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              {block.title || getDefaultValueForTitle(block.type)}
            </h4>
            {canEditTitle && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditTitle(true);
                }}
                className="ml-2"
                style={{ color: "var(--violet-9)" }}
                title="Edit Title"
              >
                <PiPencilSimpleFill />
              </a>
            )}
            {shouldShowGlobalControlOptOutBadge ? (
              <Badge
                label="Uses block date filter"
                color="gray"
                variant="soft"
                size="xs"
                ml="2"
              />
            ) : null}
            {shouldShowExperimentFilterOptOutBadge ? (
              <Badge
                label="Uses block filters"
                color="gray"
                variant="soft"
                size="xs"
                ml="2"
              />
            ) : null}

            <div style={{ flexGrow: 1, marginRight: 30 }} />
          </>
        )}

        {
          <div>
            {!editingBlock && (
              <DropdownMenu
                open={dropdownOpen}
                onOpenChange={setDropdownOpen}
                variant="soft"
                menuPlacement="end"
                trigger={
                  <IconButton
                    variant="ghost"
                    radius="full"
                    size="1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BsThreeDotsVertical />
                  </IconButton>
                }
              >
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    editBlock();
                    setDropdownOpen(false);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateBlock();
                    setDropdownOpen(false);
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                {disableBlock === "none" && addBlockBefore && addBlockAfter && (
                  <>
                    <DropdownSubMenu trigger="Add block before">
                      <DashboardBlockTypeMenuItems
                        isGeneralDashboard={isGeneralDashboard}
                        onSelect={(bType) => {
                          addBlockBefore(bType);
                          setDropdownOpen(false);
                        }}
                      />
                    </DropdownSubMenu>
                    <DropdownSubMenu trigger="Add block after">
                      <DashboardBlockTypeMenuItems
                        isGeneralDashboard={isGeneralDashboard}
                        onSelect={(bType) => {
                          addBlockAfter(bType);
                          setDropdownOpen(false);
                        }}
                      />
                    </DropdownSubMenu>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteBlock();
                    setDropdownOpen(false);
                  }}
                  color="red"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        }
      </Flex>
      <Text>{block.description}</Text>
      <DashboardBlockContent
        isTabActive={isTabActive}
        block={block}
        dashboardGlobalControls={dashboardGlobalControls}
        dashboardComparison={dashboardComparison}
        blockIndex={blockIndex}
        setBlock={setBlock}
        isEditing
      />
    </Flex>
  );
}
