import { HoldoutInterfaceStringDates } from "shared/validators";
import { getAllVariations } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box } from "@radix-ui/themes";
import { date } from "shared/dates";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useUser } from "@/services/UserContext";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";

interface Props {
  holdout: HoldoutInterfaceStringDates;
  experiments: ExperimentInterfaceStringDates[];
}

const LinkedExperimentsTable = ({ holdout, experiments }: Props) => {
  const { getOwnerDisplay } = useUser();

  const experimentItems = useAddComputedFields(
    experiments,
    (exp) => ({
      ...exp,
      ownerNameDisplay: getOwnerDisplay(exp.owner),
      dateAdded: holdout.linkedExperiments[exp.id]?.dateAdded,
      dateEnded: exp.phases[exp.phases.length - 1]?.dateEnded,
    }),
    [getOwnerDisplay, holdout],
  );

  const { items, SortableTableColumnHeader } = useSearch({
    items: experimentItems,
    defaultSortField: "dateAdded",
    localStorageKey: "holdoutLinkedExperiments",
    searchFields: ["name", "status", "ownerNameDisplay"],
    disableUrlSearchTerm: true,
  });

  if (items.length === 0) {
    return (
      <Box mt="4">
        <Text>
          <em>
            Add new <Link href="/experiments">Experiments</Link> to this
            Holdout.
          </em>
        </Text>
      </Box>
    );
  }

  return (
    <Table variant="list" roundedCorners mt="3">
      <TableHeader>
        <TableRow>
          <SortableTableColumnHeader field="name">
            Experiment
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="status">
            Status
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="releasedVariationId">
            Shipped variation
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="ownerNameDisplay">
            Owner
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="dateAdded">
            Added
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="dateEnded">
            Ended
          </SortableTableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((exp) => {
          const variations = getAllVariations(exp);
          const variationIndex = variations.findIndex(
            (v) => v.id === exp.releasedVariationId,
          );
          const variation = variations[variationIndex];
          return (
            <TableRow key={exp.id}>
              <TableCell style={{ padding: "var(--space-0)" }}>
                <Link
                  href={`/experiment/${exp.id}`}
                  style={{
                    padding: "var(--space-3)",
                    display: "block",
                    color: "var(--color-text-high)",
                  }}
                >
                  {exp.name}
                </Link>
              </TableCell>
              <TableCell>
                <ExperimentStatusIndicator experimentData={exp} size="xs" />
              </TableCell>
              <TableCell>
                {variation ? (
                  <VariationLabel
                    number={variationIndex}
                    name={variation.name}
                    size="md"
                    maxWidth="170px"
                  />
                ) : (
                  "--"
                )}
              </TableCell>
              <TableCell>{exp.ownerNameDisplay}</TableCell>
              <TableCell>{exp.dateAdded ? date(exp.dateAdded) : ""}</TableCell>
              <TableCell>{exp.dateEnded ? date(exp.dateEnded) : ""}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default LinkedExperimentsTable;
