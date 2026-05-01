import { FaExternalLinkAlt } from "react-icons/fa";
import Link from "@/ui/Link";
import DataList from "./DataList";

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
            <Link onClick={() => {}}>
              Link Value <FaExternalLinkAlt />
            </Link>
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
