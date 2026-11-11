import { Flex } from "@radix-ui/themes";
import { PiArrowLeft } from "react-icons/pi";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";
import TextField from "@/ui/TextField";

/**
 * The source a query modal's Configure step reads from: the picked table with
 * a Change link, or the SQL with an Edit SQL link.
 */
export default function SourceSummary({
  table,
  sql,
  onEdit,
}: {
  /** The picked table's path, or null when the source is SQL. */
  table: string | null;
  sql: string;
  onEdit: () => void;
}) {
  if (table) {
    return (
      <TextField
        label="Source table"
        value={table.replace(/`/g, "")}
        readOnly
        append={<Link onClick={onEdit}>Change</Link>}
      />
    );
  }
  return (
    <Code
      language="sql"
      code={sql}
      expandable
      collapsedLines={3}
      filename={
        <Link onClick={onEdit}>
          <Flex align="center" gap="1">
            <PiArrowLeft /> Edit SQL
          </Flex>
        </Link>
      }
    />
  );
}
