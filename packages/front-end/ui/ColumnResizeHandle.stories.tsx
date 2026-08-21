import { useRef, useState } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "./Table";
import ColumnResizeHandle from "./ColumnResizeHandle";

const COLUMNS = [
  { id: "name", label: "Name", defaultWidth: 200 },
  // No default width: absorbs the remaining slack, like Description on
  // the Attributes table.
  { id: "description", label: "Description", defaultWidth: undefined },
  { id: "status", label: "Status", defaultWidth: 140 },
  { id: "date", label: "Date", defaultWidth: 160 },
];

const ROWS = [
  {
    name: "Item One",
    description: "The first item",
    status: "Active",
    date: "Jan 15",
  },
  {
    name: "Item Two",
    description: "The second item",
    status: "Draft",
    date: "Jan 14",
  },
  {
    name: "Item Three",
    description: "The third item",
    status: "Active",
    date: "Jan 13",
  },
];

function ResizableTable({ scrollX }: { scrollX?: boolean }) {
  const [widths, setWidths] = useState<Record<string, number | undefined>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.id, c.defaultWidth])),
  );
  const colRefs = useRef<Map<string, HTMLTableColElement | null>>(new Map());

  return (
    <Table
      variant="list"
      stickyHeader
      roundedCorners
      layout="fixed"
      scrollX={scrollX}
    >
      <colgroup>
        {COLUMNS.map((col) => (
          <col
            key={col.id}
            ref={(el) => {
              colRefs.current.set(col.id, el);
            }}
            style={widths[col.id] ? { width: widths[col.id] } : undefined}
          />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((col) => (
            <TableColumnHeader key={col.id}>
              {col.label}
              <ColumnResizeHandle
                label={col.label}
                width={widths[col.id]}
                minWidth={64}
                maxWidth={800}
                onCommit={(w) =>
                  setWidths((prev) => ({ ...prev, [col.id]: w }))
                }
                setLiveWidth={(w) => {
                  const el = colRefs.current.get(col.id);
                  if (el) el.style.width = `${w}px`;
                }}
              />
            </TableColumnHeader>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.name}>
            {COLUMNS.map((col) => (
              <TableCell key={col.id}>
                {row[col.id as keyof typeof row]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ColumnResizeHandleStories() {
  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Text weight="medium">Drag, double-click and keyboard resize</Text>
        <Text size="sm" color="text-low">
          The handle sits in the right 8px of each header cell and is invisible
          until you hover it. Drag to resize; double-click to reset one column;
          or focus a handle and use Left/Right (Shift for a larger step, Home to
          reset). A fixed layout and a <code>&lt;colgroup&gt;</code> are what
          make the widths authoritative — Description declares no width, so it
          absorbs the slack.
        </Text>
        <ResizableTable />
      </Flex>
      <Flex direction="column" gap="2">
        <Text weight="medium">Inside a scrollX region</Text>
        <Text size="sm" color="text-low">
          Widen the columns past the container to scroll horizontally. The
          header sticks to the top of the scroll region rather than the
          viewport.
        </Text>
        <ResizableTable scrollX />
      </Flex>
    </Flex>
  );
}
