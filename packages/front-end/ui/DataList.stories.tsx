import { FaExternalLinkAlt } from "react-icons/fa";
import { StoryMeta } from "@/ui/storyMeta";
import DataList from "./DataList";

export const meta: StoryMeta = {
  name: "DataList",
  category: "data-display",
  status: "stable",
  summary:
    "Grid of labeled values for one record, with optional tooltips and a header.",
  useWhen: ["Showing several properties of one object in columns."],
  avoidWhen: [
    {
      reason: "One or two inline label and value pairs.",
      use: "Metadata",
    },
    {
      reason: "Many records with shared columns.",
      use: "Table",
    },
  ],
  related: ["Metadata"],
};

export default function DataListStories() {
  return (
    <DataList
      header="Header"
      columns={4}
      data={[
        { label: "Label 1", value: "Value 1" },
        {
          label: "Label 2",
          value: "A very long value that will wrap to multiple lines",
        },
        {
          label: "With Tooltip",
          value: "Value 3",
          tooltip: "This is a label tooltip",
        },
        {
          label: "Label 4",
          value: (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
              }}
            >
              Link Value <FaExternalLinkAlt />
            </a>
          ),
        },
        {
          label: "Label 5",
          value: (
            <>
              <em>Other</em> value{" "}
              <span className="text-muted">formatting</span>
            </>
          ),
        },
        { label: "Label 6", value: "Value 6" },
      ]}
    />
  );
}
