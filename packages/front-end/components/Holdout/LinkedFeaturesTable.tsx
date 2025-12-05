import { HoldoutInterface } from "back-end/src/validators/holdout";
import { Box, Text } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import { FeatureInterface } from "back-end/types/feature";
import { useAddComputedFields, useSearch } from "@/services/search";
import Link from "@/ui/Link";
import ValueDisplay from "../Features/ValueDisplay";

interface Props {
  holdout: HoldoutInterface;
  features: FeatureInterface[];
}

const LinkedFeaturesTable = ({ holdout, features }: Props) => {
  const featureItems = useAddComputedFields(
    features,
    (f) => {
      return {
        ...features,
        dateAdded: holdout.linkedFeatures[f.id]?.dateAdded,
        holdoutValue: f.holdout?.value,
      };
    },
    [holdout, features],
  );

  const { items, SortableTH } = useSearch({
    items: featureItems,
    defaultSortField: "dateAdded",
    localStorageKey: "holdoutLinkedFeatures",
    searchFields: ["id", "owner", "valueType"],
  });

  const router = useRouter();

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
    <Box>
      <table className="appbox table gbtable">
        <thead>
          <tr>
            <SortableTH field="id">Feature Name</SortableTH>
            <SortableTH field="valueType">Type</SortableTH>
            <SortableTH field="holdoutValue">Holdout Value</SortableTH>
            <SortableTH field="owner">Owner</SortableTH>
            <SortableTH field="dateCreated">Created</SortableTH>
            <SortableTH field="dateAdded">In Holdout</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => {
            return (
              <tr
                key={f.id}
                className="hover-highlight"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/features/${f.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <td data-title="Feature Name" className="col-2">
                  <Link href={`/features/${f.id}`}>{f.id}</Link>
                </td>
                <td data-title="Type">{f.valueType}</td>
                <td data-title="Holdout Value">
                  <ValueDisplay
                    value={f.holdoutValue ?? f.defaultValue}
                    type={f.valueType}
                  />
                </td>
                <td data-title="Owner" className="col-2">
                  {f.owner}
                </td>
                <td data-title="Created">{date(f.dateCreated)}</td>
                <td data-title="Date Added">
                  {f.dateAdded ? date(f.dateAdded) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

export default LinkedFeaturesTable;
