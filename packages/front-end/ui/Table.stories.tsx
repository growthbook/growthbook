import { Flex } from "@radix-ui/themes";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "./Table";

const sampleRows = [
  { name: "Item One", status: "Active", date: "Jan 15, 2025" },
  { name: "Item Two", status: "Draft", date: "Jan 14, 2025" },
  { name: "Item Three", status: "Active", date: "Jan 13, 2025" },
];

export default function TableStories() {
  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>
          List variant (sticky header, rounded corners)
        </span>
        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader>Date</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleRows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Flex>
      <Flex direction="column" gap="2">
        <span style={{ fontWeight: 600 }}>Surface variant (minimal)</span>
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Column A</TableColumnHeader>
              <TableColumnHeader>Column B</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Cell 1</TableCell>
              <TableCell>Cell 2</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Cell 3</TableCell>
              <TableCell>Cell 4</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Flex>
    </Flex>
  );
}
