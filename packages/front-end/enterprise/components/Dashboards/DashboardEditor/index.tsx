import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useEffect, useState } from "react";
import { PiArrowLeft, PiCaretDownFill, PiTrashFill } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import {
  DashboardData,
  DashboardInstanceInterface,
  DashboardSettings,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { DashboardBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Field from "@/components/Forms/Field";
import DashboardBlock from "./DashboardBlock";
import DashboardSettingsHeader from "./DashboardSettingsHeader";

const BLOCK_TYPE_INFO = {
  markdown: {
    name: "Custom Markdown",
    defaultBlock: { type: "markdown", content: "" },
  },
  metadata: {
    name: "Experiment Metadata",
    defaultBlock: { type: "metadata", subtype: "description" },
  },
  "variation-image": {
    name: "Variation Image",
    defaultBlock: { type: "variation-image", variationIds: [] },
  },
  metric: {
    name: "Metric Analysis",
    defaultBlock: { type: "metric", metricId: "", variationIds: [] },
  },
  dimension: {
    name: "Metric Dimensional Analysis",
    defaultBlock: {
      type: "dimension",
      dimensionId: "",
      metricId: "",
      variationIds: [],
    },
  },
  "time-series": {
    name: "Results Time Series",
    defaultBlock: {
      type: "time-series",
      metricId: "",
      variationIds: [],
      dateStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      dateEnd: new Date(),
    },
  },
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  dashboard?: DashboardInstanceInterface;
  defaultSettings: DashboardSettings;
  back: () => void;
  cancel: () => void;
  submit: (dashboard: DashboardData) => Promise<void>;
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
  const [blocks, setBlocks] = useState<DashboardBlockInterface[]>(
    dashboard?.blocks || []
  );
  const [title, setTitle] = useState<string>(dashboard?.title || "");
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(
    dashboard?.settings || defaultSettings
  );

  const [localEditing, setLocalEditing] = useState<boolean>(isEditing);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  useEffect(() => {
    setLocalEditing(isEditing);
  }, [isEditing]);

  const canSubmit = blocks.length > 0 && title;

  return (
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
                      settings: dashboardSettings,
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
              settings={dashboardSettings}
              updateSettings={setDashboardSettings}
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
                settings={dashboardSettings}
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
              {Object.keys(BLOCK_TYPE_INFO).map((bType) => (
                <DropdownMenuItem
                  key={bType}
                  onClick={() => {
                    setDropdownOpen(false);
                    setBlocks([...blocks, BLOCK_TYPE_INFO[bType].defaultBlock]);
                  }}
                >
                  {BLOCK_TYPE_INFO[bType].name}
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
