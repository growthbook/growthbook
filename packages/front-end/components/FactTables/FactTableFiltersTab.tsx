import { FactTableInterface } from "shared/types/fact-table";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import useFactFilterEditor from "@/hooks/useFactFilterEditor";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
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
    <div className={styles.frame}>
      {editor.modal}
      <Flex justify="end" px="4" py="3">
        {editor.canCreate ? (
          <Button size="sm" variant="outline" onClick={editor.openNew}>
            New filter
          </Button>
        ) : null}
      </Flex>
      {filters.length ? (
        <table
          className={`table gbtable mb-0 ${styles.detailsTable}`}
          onPointerDown={() => setHighlightId("")}
          onKeyDown={() => setHighlightId("")}
        >
          <thead>
            <tr>
              <th>Name</th>
              <th>Filter SQL</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((filter) => (
              <tr
                key={filter.id}
                ref={filter.id === linkedId ? linkedRow : undefined}
                aria-current={filter.id === highlightId ? "true" : undefined}
                className={
                  filter.id === highlightId ? styles.highlightRow : undefined
                }
              >
                <td>
                  {editor.canEdit(filter) ? (
                    <Link weight="bold" onClick={() => editor.openEdit(filter)}>
                      {filter.name}
                    </Link>
                  ) : (
                    filter.name
                  )}
                  <OfficialBadge type="filter" managedBy={filter.managedBy} />
                </td>
                <td>
                  <InlineCode language="sql" code={filter.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Box px="4" pb="3">
          <Text color="text-mid">No Saved Filters on this Fact Table yet.</Text>
        </Box>
      )}
    </div>
  );
}
