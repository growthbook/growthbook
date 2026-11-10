import { FactTableInterface } from "shared/types/fact-table";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import useFactFilterEditor from "@/hooks/useFactFilterEditor";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import styles from "./FactTableDetailsPage.module.scss";

export default function FactTableFiltersTab({
  factTable,
}: {
  factTable: FactTableInterface;
}) {
  const editor = useFactFilterEditor(factTable);

  // `?filter=<id>` deep-links one Saved Filter. The highlight is only a
  // landing cue: drop the query once the row is in view.
  const router = useRouter();
  const linkedId =
    typeof router.query.filter === "string" ? router.query.filter : "";
  const [highlightId, setHighlightId] = useState(linkedId);
  const linkedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!linkedId) return;
    setHighlightId(linkedId);
    linkedRow.current?.scrollIntoView({ block: "center" });
    const query = { ...router.query };
    delete query.filter;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  }, [linkedId, router]);

  const filters = [...factTable.filters].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <Flex direction="column" gap="3">
      {editor.modal}
      <Flex justify="end">
        {editor.canCreate ? (
          <Button size="sm" variant="outline" onClick={editor.openNew}>
            New Saved Filter
          </Button>
        ) : null}
      </Flex>
      {filters.length ? (
        <Table
          variant="list"
          roundedCorners
          onPointerDown={() => setHighlightId("")}
          onKeyDown={() => setHighlightId("")}
        >
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Filter SQL</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filters.map((filter) => (
              <TableRow
                key={filter.id}
                align="center"
                ref={filter.id === linkedId ? linkedRow : undefined}
                aria-current={filter.id === highlightId ? "true" : undefined}
                className={
                  filter.id === highlightId ? styles.highlightRow : undefined
                }
              >
                <TableCell>
                  {editor.canEdit(filter) ? (
                    <Link weight="bold" onClick={() => editor.openEdit(filter)}>
                      {filter.name}
                    </Link>
                  ) : (
                    filter.name
                  )}
                  <OfficialBadge type="filter" managedBy={filter.managedBy} />
                </TableCell>
                <TableCell>
                  <InlineCode language="sql" code={filter.value} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Text color="text-mid">No Saved Filters on this Fact Table yet.</Text>
      )}
    </Flex>
  );
}
