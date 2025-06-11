import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useEffect, useState } from "react";
import { PiArrowLeft, PiCaretDownFill, PiTrashFill } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import {
  DashboardInstanceInterface,
  DashboardSettingsInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { DashboardBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { DashboardBlockData } from "back-end/src/enterprise/models/DashboardBlockModel";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Field from "@/components/Forms/Field";
import DashboardProvider from "../DashboardSnapshotProvider";
import DashboardSettingsProvider from "../DashboardSettingsProvider";
import DashboardBlock from "./DashboardBlock";
import DashboardSettingsHeader from "./DashboardSettingsHeader";

const BLOCK_TYPE_INFO: Record<
  DashboardBlockInterface["type"],
  {
    name: string;
    createDefaultBlock: (args: {
      experimentId: string;
    }) => DashboardBlockData<DashboardBlockInterface>;
  }
> = {
  markdown: {
    name: "Custom Markdown",
    createDefaultBlock: () => ({ type: "markdown", content: "" }),
  },
  metadata: {
    name: "Experiment Metadata",
    createDefaultBlock: ({ experimentId }) => ({
      type: "metadata",
      subtype: "description",
      experimentId,
    }),
  },
  "variation-image": {
    name: "Variation Image",
    createDefaultBlock: ({ experimentId }) => ({
      type: "variation-image",
      variationIds: [],
      experiment: experimentId,
    }),
  },
  metric: {
    name: "Metric Analysis",
    createDefaultBlock: () => ({
      type: "metric",
    }),
  },
  dimension: {
    name: "Metric Dimensional Analysis",
    createDefaultBlock: () => ({
      type: "dimension",
    }),
  },
  "time-series": {
    name: "Results Time Series",
    createDefaultBlock: () => ({
      type: "time-series",
    }),
  },
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  dashboard?: DashboardInstanceInterface;
  defaultSettings: DashboardSettingsInterface;
  back: () => void;
  cancel: () => void;
  submit: (dashboard: {
    title: string;
    blocks: DashboardBlockData<DashboardBlockInterface>[];
    settings: DashboardSettingsInterface;
  }) => Promise<void>;
  isEditing: boolean;
  mutate: () => void;
  setEditing: (editing: boolean) => void;
}

export default function DashboardEditor({
  experiment,
  dashboard,
  defaultSettings,
  back,
  cancel,
  submit,
  isEditing,
  setEditing,
  mutate,
}: Props) {
  const [blocks, setBlocks] = useState<
    DashboardBlockData<DashboardBlockInterface>[]
  >(dashboard?.blocks || []);
  const [title, setTitle] = useState<string>(dashboard?.title || "");
  const [settings, setSettings] = useState<DashboardSettingsInterface>(
    dashboard ? dashboard.settings : defaultSettings
  );

  const [localEditing, setLocalEditing] = useState<boolean>(isEditing);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  useEffect(() => {
    setLocalEditing(isEditing);
  }, [isEditing]);

  const canSubmit = blocks.length > 0 && title;

  return (
    <DashboardProvider
      dashboardId={dashboard?.id || ""}
      experiment={experiment}
    >
      <DashboardSettingsProvider settings={settings} setSettings={setSettings}>
        <div className="mt-3">
          <div className="appbox mx-3 p-4">
            <div className="d-flex justify-content-between align-items-center">
              <Button color="gray" variant="ghost" onClick={back}>
                <PiArrowLeft />
                Back
              </Button>
              {!isEditing && (
                <Button
                  color="violet"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
            </div>
            {isEditing ? (
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="mb-0">
                  <Field
                    placeholder="Dashboard Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </h3>
                <div className="d-flex gap-2">
                  <Button color="gray" onClick={cancel}>
                    Cancel
                  </Button>
                  <Button
                    color="violet"
                    variant="outline"
                    onClick={() => setLocalEditing(!localEditing)}
                  >
                    {localEditing ? "Preview" : "Edit"}
                  </Button>
                  <Button
                    color="violet"
                    onClick={() => {
                      if (canSubmit)
                        submit({
                          title,
                          blocks,
                          settings,
                        });
                    }}
                    disabled={!canSubmit}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="">
              <div>
                <DashboardSettingsHeader
                  isEditing={localEditing}
                  experiment={experiment}
                />
              </div>
              {blocks.map((block, i) => (
                <div key={i} className="appbox p-4">
                  {localEditing && (
                    <Flex align="center" justify="between">
                      <h4 className="text-capitalize">
                        {BLOCK_TYPE_INFO[block.type].name}
                      </h4>
                      <Button
                        color="red"
                        onClick={() => {
                          setBlocks(blocks.filter((_, j) => j !== i));
                        }}
                      >
                        <PiTrashFill />
                      </Button>
                    </Flex>
                  )}

                  <DashboardBlock
                    block={block}
                    experiment={experiment}
                    isEditing={localEditing}
                    setBlock={(block: DashboardBlockInterface) => {
                      setBlocks(blocks.map((b, j) => (j === i ? block : b)));
                    }}
                    mutate={mutate}
                  />
                </div>
              ))}
              {localEditing && (
                <DropdownMenu
                  variant="solid"
                  open={dropdownOpen}
                  onOpenChange={(o) => {
                    setDropdownOpen(!!o);
                  }}
                  trigger={
                    <Button color="gray">
                      <span>
                        Add Block
                        <PiCaretDownFill />
                      </span>
                    </Button>
                  }
                >
                  {Object.entries(BLOCK_TYPE_INFO).map(([bType, bInfo]) => (
                    <DropdownMenuItem
                      key={bType}
                      onClick={() => {
                        setDropdownOpen(false);
                        setBlocks([
                          ...blocks,
                          bInfo.createDefaultBlock({
                            experimentId: experiment.id,
                          }),
                        ]);
                      }}
                    >
                      {bInfo.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </DashboardSettingsProvider>
    </DashboardProvider>
  );
}
