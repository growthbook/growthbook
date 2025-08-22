import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { Fragment } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { PiDotsThreeVertical } from "react-icons/pi";
import { isPersistedDashboardBlock } from "shared/enterprise";
import Button from "@/components/Radix/Button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenu,
} from "@/components/Radix/DropdownMenu";
import { BLOCK_SUBGROUPS, BLOCK_TYPE_INFO } from "..";
import EditSingleBlock from "./EditSingleBlock";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  open: boolean;
  cancel: () => void;
  submit: () => void;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  stagedBlock:
    | DashboardBlockInterfaceOrData<DashboardBlockInterface>
    | undefined;
  setStagedBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >;
  addBlockType: (bType: DashboardBlockType, i?: number) => void;
  focusBlock: (index: number) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
}

export default function DashboardEditorSidebar({
  experiment,
  open,
  cancel,
  submit,
  blocks,
  stagedBlock,
  setStagedBlock,
  addBlockType,
  focusBlock,
  editBlock,
  duplicateBlock,
  deleteBlock,
}: Props) {
  return (
    <div
      id="edit-drawer"
      style={{
        display: "flex",
        transition: "all 0.5s cubic-bezier(0.685, 0.0473, 0.346, 1)",
        width: open ? "440px" : "0px",
        overflow: "clip",
        zIndex: 9001,
        backgroundColor: "var(--surface-background-color)",
      }}
    >
      {isDefined(stagedBlock) ? (
        <EditSingleBlock
          experiment={experiment}
          cancel={cancel}
          submit={submit}
          block={stagedBlock}
          setBlock={setStagedBlock}
        />
      ) : (
        <Tabs defaultValue="add-block" style={{ width: "100%" }}>
          <TabsList>
            <TabsTrigger value="add-block">Add Block</TabsTrigger>
            <TabsTrigger value="block-navigator">Block Navigator</TabsTrigger>
          </TabsList>
          <TabsContent value="add-block">
            <Flex direction="column" align="start" p="2">
              <Text style={{ color: "var(--color-text-mid)" }} my="3">
                Click to add blocks.
              </Text>
              {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => (
                <Fragment key={`${subgroup}-${i}`}>
                  <Text
                    weight="medium"
                    size="1"
                    style={{
                      color: "var(--color-text-high)",
                      textTransform: "uppercase",
                    }}
                  >
                    {subgroup}
                  </Text>
                  {blockTypes.map((bType) => (
                    <Button
                      variant="ghost"
                      key={bType}
                      onClick={() => {
                        addBlockType(bType);
                      }}
                    >
                      {/* TODO: icon */}
                      <Text
                        size="2"
                        weight="regular"
                        style={{ color: "var(--color-text-high" }}
                      >
                        {BLOCK_TYPE_INFO[bType].name}
                      </Text>
                    </Button>
                  ))}
                  {i < BLOCK_SUBGROUPS.length - 1 && <DropdownMenuSeparator />}
                </Fragment>
              ))}
            </Flex>
          </TabsContent>
          <TabsContent value="block-navigator">
            <Flex direction="column" align="start" p="2">
              <Text style={{ color: "var(--color-text-mid)" }} my="3">
                Drag to reorder blocks. Click to bring block into focus.
              </Text>
              {blocks.map((block, i) => (
                <Flex
                  width="100%"
                  justify="between"
                  key={isPersistedDashboardBlock(block) ? block.id : i}
                  my="2"
                  onClick={() => focusBlock(i)}
                  className="hover-border-violet"
                  align="center"
                  p="1"
                  style={{ cursor: "pointer" }}
                >
                  {/* TODO: icon */}
                  <Text>{BLOCK_TYPE_INFO[block.type].name}</Text>

                  <DropdownMenu
                    trigger={
                      <IconButton variant="ghost" size="1">
                        <PiDotsThreeVertical />
                      </IconButton>
                    }
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        editBlock(i);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        duplicateBlock(i);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        deleteBlock(i);
                      }}
                    >
                      <Text color="red">Delete</Text>
                    </DropdownMenuItem>
                  </DropdownMenu>
                </Flex>
              ))}
            </Flex>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
