import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Box, Text } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { date } from "shared/dates";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useUser } from "@/services/UserContext";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import Link from "@/ui/Link";
import Tooltip from "../Tooltip/Tooltip";

interface Props {
  holdout: HoldoutInterface;
  experiments: ExperimentInterfaceStringDates[];
}

const LinkedExperimentsTable = ({ holdout, experiments }: Props) => {
  const { getUserDisplay } = useUser();
  const getExperimentStatusIndicator = useExperimentStatusIndicator();

  const experimentItems = useAddComputedFields(
    experiments,
    (exp) => {
      const statusIndicator = getExperimentStatusIndicator(exp);
      return {
        ...experiments,
        dateAdded: holdout.linkedExperiments[exp.id]?.dateAdded,
        dateEnded: exp.phases[exp.phases.length - 1]?.dateEnded,
        statusIndicator,
      };
    },
    [holdout, experiments],
  );

  const { items, SortableTH } = useSearch({
    items: experimentItems,
    defaultSortField: "dateAdded",
    localStorageKey: "holdoutLinkedExperiments",
    searchFields: ["name", "status", "owner"],
  });

  const router = useRouter();

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
    <Box>
      <table className="appbox table gbtable">
        <thead>
          <tr>
            <SortableTH field="name">Experiment Name</SortableTH>
            <SortableTH field="status">Status</SortableTH>
            <SortableTH field="releasedVariationId">
              Shipped Variation
            </SortableTH>
            <SortableTH field="owner">Owner</SortableTH>
            <SortableTH field="dateAdded">In Holdout</SortableTH>
            <SortableTH field="dateEnded">Date Ended</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((exp) => {
            const variationIndex = exp.variations.findIndex(
              (v) => v.id === exp.releasedVariationId,
            );
            const variation = exp.variations[variationIndex];
            return (
              <tr
                key={exp.id}
                className="hover-highlight"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/experiment/${exp.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <td data-title="Experiment Name" className="col-2">
                  <Link href={`/experiment/${exp.id}`}>{exp.name}</Link>
                </td>
                <td data-title="Status">
                  {exp.statusIndicator.tooltip &&
                  !exp.statusIndicator.detailedStatus ? (
                    <Tooltip body={exp.statusIndicator.tooltip}>
                      {exp.statusIndicator.status}
                    </Tooltip>
                  ) : (
                    exp.statusIndicator.status
                  )}
                </td>
                <td data-title="Shipped Variation">
                  {variation ? (
                    <div
                      className={`variation variation${variationIndex} with-variation-label d-flex align-items-center`}
                    >
                      <span
                        className="label"
                        style={{ width: 20, height: 20, flex: "none" }}
                      >
                        {variationIndex}
                      </span>
                      <span
                        className="d-inline-block"
                        style={{
                          width: 150,
                          lineHeight: "14px",
                        }}
                      >
                        {variation?.name}
                      </span>
                    </div>
                  ) : (
                    <span>--</span>
                  )}
                </td>
                <td data-title="Owner" className="col-2">
                  {getUserDisplay(exp.owner, false)}
                </td>
                <td data-title="Date Added">
                  {exp.dateAdded ? date(exp.dateAdded) : ""}
                </td>
                <td data-title="Date Ended">
                  {exp.dateEnded ? date(exp.dateEnded) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

export default LinkedExperimentsTable;
