import { ExperimentReportVariation } from "shared/types/report";
import { Box } from "@radix-ui/themes";
import clsx from "clsx";
import { pValueFormatter } from "@/services/experiments";
import VariationLabel from "@/ui/VariationLabel";
import Text from "@/ui/Text";
import ScrollArea, { pinnedTo } from "@/ui/ScrollArea";
import styles from "./VariationUsersTable.module.scss";

export interface Props {
  variations: ExperimentReportVariation[];
  users: number[];
  srm?: number;
  hideVariationIndex?: boolean;
}

const numberFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function VariationUsersTable({
  variations,
  users,
  srm,
  hideVariationIndex,
}: Props) {
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const totalWeight = variations
    .map((v) => v.weight)
    .reduce((sum, n) => sum + n, 0);

  const pinned = clsx(styles.pinned, pinnedTo.left);

  return (
    <>
      <ScrollArea
        direction="horizontal"
        size="md"
        gutter
        alwaysShow
        wheelScrollsSideways
        edgeCue="fade"
        skipEdges={["left"]}
      >
        <table className={clsx("table mt-0 mb-0", styles.table)}>
          <thead>
            <tr>
              <th
                className={clsx("border-top-0", pinned)}
                style={{ whiteSpace: "nowrap", width: "30%", minWidth: 150 }}
              >
                Variation
              </th>
              <th
                className="border-top-0"
                style={{ whiteSpace: "nowrap", width: "17.5%" }}
              >
                Actual Units
              </th>
              <th
                className="border-top-0"
                style={{ whiteSpace: "nowrap", width: "17.5%" }}
              >
                Expected Units
              </th>
              <th
                className="border-top-0"
                style={{ whiteSpace: "nowrap", width: "17.5%" }}
              >
                Actual %
              </th>
              <th
                className="border-top-0"
                style={{ whiteSpace: "nowrap", width: "17.5%" }}
              >
                Expected %
              </th>
            </tr>
          </thead>
          <tbody>
            {variations.map((v, i) => {
              return (
                <tr key={v.id}>
                  {/* Held to its share of the width, so a long name truncates. */}
                  <td
                    className={clsx("border-right", pinned)}
                    style={{ maxWidth: 0 }}
                  >
                    {hideVariationIndex ? (
                      <Text color="text-mid" weight="medium">
                        {v.name}
                      </Text>
                    ) : (
                      <VariationLabel number={v.index} name={v.name} />
                    )}
                  </td>
                  <td className="text-nowrap">
                    <b>{numberFormatter.format(users[i] || 0)}</b>
                  </td>
                  <td className="border-right text-nowrap">
                    {numberFormatter.format(
                      totalUsers * (v.weight / totalWeight) || 0,
                    )}
                  </td>
                  <td className="text-nowrap">
                    <b>
                      {totalUsers > 0
                        ? percentFormatter.format(users[i] / totalUsers)
                        : "-"}
                    </b>
                  </td>
                  <td className="text-nowrap">
                    {totalWeight > 0
                      ? percentFormatter.format(v.weight / totalWeight)
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
      {srm !== undefined ? (
        <Box px="3" py="2">
          <Text color="text-mid">p-value = {pValueFormatter(srm)}</Text>
        </Box>
      ) : null}
    </>
  );
}
