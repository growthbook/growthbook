import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useEffect, useState } from "react";
import { PiArrowLeft, PiCaretDownFill, PiTrashFill } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { ExperimentReportInterface } from "back-end/src/enterprise/validators/experiment-report";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Field from "@/components/Forms/Field";
import ReportBlock, { Block } from "./ReportBlock";

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
  report?: ExperimentReportInterface;
  back: () => void;
  cancel: () => void;
  submit: (
    reportData: Pick<ExperimentReportInterface, "title" | "content">
  ) => Promise<void>;
  isEditing: boolean;
  mutate: () => void;
  setEditing: (editing: boolean) => void;
}

export default function ReportEditor({
  experiment,
  report,
  back,
  cancel,
  submit,
  isEditing,
  setEditing,
  mutate,
}: Props) {
  const [content, setContent] = useState<ExperimentReportInterface["content"]>(
    report?.content || []
  );
  const [title, setTitle] = useState<string>(report?.title || "");
  const [localEditing, setLocalEditing] = useState<boolean>(isEditing);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  useEffect(() => {
    setLocalEditing(isEditing);
  }, [isEditing]);

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
                placeholder="Report Title"
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
                  if (content && title) submit({ title, content });
                }}
                disabled={!content}
              >
                Save
              </Button>
            </div>
          </div>
        ) : null}

        <div className="">
          {content.map((block, i) => (
            <div key={i} className="appbox p-4">
              {localEditing && (
                <Flex align="center" justify="between">
                  <h4 className="text-capitalize">
                    {BLOCK_TYPE_INFO[block.type].name}
                  </h4>
                  <Button
                    color="red"
                    onClick={() => {
                      setContent(content.filter((_, j) => j !== i));
                    }}
                  >
                    <PiTrashFill />
                  </Button>
                </Flex>
              )}

              <ReportBlock
                block={block}
                experiment={experiment}
                isEditing={localEditing}
                setBlock={(block: Block) => {
                  setContent(content.map((b, j) => (j === i ? block : b)));
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
                    setContent([
                      ...content,
                      BLOCK_TYPE_INFO[bType].defaultBlock,
                    ]);
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
