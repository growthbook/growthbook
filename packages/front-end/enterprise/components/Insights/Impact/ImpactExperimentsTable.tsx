import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";
import { useSearch } from "@/services/search";
import { ExperimentImpactRow } from "./impactData";

const ROWS_SHOWN = 8;

type TableItem = {
  id: string;
  name: string;
  result: "won" | "lost";
  lift: number | null;
  value: number;
};

export default function ImpactExperimentsTable({
  rows,
  formatAnnual,
}: {
  rows: ExperimentImpactRow[];
  formatAnnual: (v: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo<TableItem[]>(
    () =>
      rows.flatMap((r) =>
        r.annualValue !== null && r.result !== "other"
          ? [
              {
                id: r.id,
                name: r.name,
                result: r.result,
                lift: r.relativeLift,
                value: r.annualValue,
              },
            ]
          : [],
      ),
    [rows],
  );
  const { items: sorted, SortableTableColumnHeader } = useSearch({
    items,
    searchFields: ["name"],
    localStorageKey: "insights-impact-experiments",
    defaultSortField: "value",
    defaultSortDir: -1,
    // Sort only; the page's search box owns `q`
    controlledSearchValue: "",
  });
  const shown = expanded ? sorted : sorted.slice(0, ROWS_SHOWN);

  return (
    <Frame mb="0" py="4" px="4">
      <Heading as="h3" size="sm" mb="2">
        Experiments
      </Heading>
      {items.length === 0 ? (
        <Text color="text-mid">
          No completed experiments with a won or lost result match.
        </Text>
      ) : (
        <Table variant="ghost">
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader
                field="name"
                style={{ whiteSpace: "nowrap" }}
              >
                Experiment
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="result"
                style={{ whiteSpace: "nowrap" }}
              >
                Result
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="lift"
                style={{ whiteSpace: "nowrap" }}
              >
                Lift
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="value"
                style={{ whiteSpace: "nowrap" }}
              >
                Scaled impact
              </SortableTableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/experiment/${item.id}`}>{item.name}</Link>
                </TableCell>
                <TableCell>
                  <ResultsIndicator results={item.result} />
                </TableCell>
                <TableCell>
                  {item.lift === null
                    ? "–"
                    : `${item.lift >= 0 ? "+" : ""}${(item.lift * 100).toFixed(1)}%`}
                </TableCell>
                <TableCell>
                  <Text weight="semibold">
                    {item.result === "won"
                      ? `${formatAnnual(item.value)}/yr`
                      : // Rolling back a variation that helped this metric forgoes value
                        `${formatAnnual(Math.abs(item.value))}/yr ${
                          item.value >= 0 ? "avoided" : "forgone"
                        }`}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {items.length > ROWS_SHOWN && (
        <Flex mt="2">
          <Link onClick={() => setExpanded(!expanded)}>
            {expanded
              ? "Show fewer"
              : `View all ${items.length} matching experiments →`}
          </Link>
        </Flex>
      )}
    </Frame>
  );
}
