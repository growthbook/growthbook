import { HoldoutInterfaceStringDates } from "shared/validators";
import { Box } from "@radix-ui/themes";
import { date } from "shared/dates";
import { FeatureInterface } from "shared/types/feature";
import { useAddComputedFields, useSearch } from "@/services/search";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useUser } from "@/services/UserContext";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";

interface Props {
  holdout: HoldoutInterfaceStringDates;
  features: FeatureInterface[];
}

const LinkedFeaturesTable = ({ holdout, features }: Props) => {
  const { getOwnerDisplay } = useUser();
  const featureItems = useAddComputedFields(
    features,
    (f) => ({
      ...f,
      ownerNameDisplay: getOwnerDisplay(f.owner),
      dateAdded: holdout.linkedFeatures[f.id]?.dateAdded,
      holdoutValue: f.holdout?.value,
    }),
    [getOwnerDisplay, holdout],
  );

  const { items, SortableTableColumnHeader } = useSearch({
    items: featureItems,
    defaultSortField: "dateAdded",
    localStorageKey: "holdoutLinkedFeatures",
    searchFields: ["id", "ownerNameDisplay", "valueType"],
    disableUrlSearchTerm: true,
  });

  if (items.length === 0) {
    return (
      <Box mt="4">
        <Text>
          <em>
            Add new <Link href="/features">Features</Link> to this Holdout.
          </em>
        </Text>
      </Box>
    );
  }

  return (
    <Table variant="list" roundedCorners mt="3">
      <TableHeader>
        <TableRow>
          <SortableTableColumnHeader field="id">
            Feature Flag
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="valueType">
            Type
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="holdoutValue">
            Holdout value
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="ownerNameDisplay">
            Owner
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="dateCreated">
            Created
          </SortableTableColumnHeader>
          <SortableTableColumnHeader field="dateAdded">
            Added
          </SortableTableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((f) => (
          <TableRow key={f.id}>
            <TableCell style={{ padding: "var(--space-0)" }}>
              <Link
                href={`/features/${f.id}`}
                style={{
                  padding: "var(--space-3)",
                  display: "block",
                  color: "var(--color-text-high)",
                }}
              >
                {f.id}
              </Link>
            </TableCell>
            <TableCell>{f.valueType}</TableCell>
            <TableCell>
              <ValueDisplay
                value={f.holdoutValue ?? f.defaultValue}
                type={f.valueType}
              />
            </TableCell>
            <TableCell>{f.ownerNameDisplay}</TableCell>
            <TableCell>{date(f.dateCreated)}</TableCell>
            <TableCell>{f.dateAdded ? date(f.dateAdded) : ""}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default LinkedFeaturesTable;
