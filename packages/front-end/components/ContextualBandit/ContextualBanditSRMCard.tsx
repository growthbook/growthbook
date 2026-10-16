import { useEffect, useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { ExperimentReportVariation } from "shared/types/report";
import { ContextualBanditSrmLatestPeriod } from "shared/validators";
import { DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION } from "shared/constants";
import { pValueFormatter } from "@/services/experiments";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import SRMCardShell, {
  SRMWarningFooter,
  useSrmHealth,
} from "@/components/HealthTab/SRMCardShell";

interface Props {
  srm: number | null;
  variations: ExperimentReportVariation[];
  users: number[];
  totalUsers: number;
  latestPeriod?: ContextualBanditSrmLatestPeriod | null;
}

export default function ContextualBanditSRMCard({
  srm,
  variations,
  users,
  totalUsers,
  latestPeriod,
}: Props) {
  const srmHealth = useSrmHealth({
    srm: srm ?? Infinity,
    numOfVariations: variations.length,
    totalUsersCount: totalUsers,
    minUsersPerVariation: DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  });

  const isUnhealthy = srmHealth === "unhealthy";
  const [isCollapsed, setIsCollapsed] = useState(!isUnhealthy);
  useEffect(() => {
    setIsCollapsed(!isUnhealthy);
  }, [isUnhealthy]);

  if (srm === null) {
    return (
      <Callout status="info">
        SRM data will appear after a successful results refresh. Make sure your
        assignment query selects the bandit_version, leaf_id, and
        variation_weights columns.
      </Callout>
    );
  }

  return (
    <SRMCardShell
      title="Balance Check"
      description={
        <>
          Shows actual unit split compared to the assigned variation weights for
          the most recent bandit period, grouped by regression tree leaf.
          <br />
          p-value below is calculated using all data, not just the most recent
          bandit period.
        </>
      }
      srmHealth={srmHealth}
      headerRight={
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            isCollapsed ? "Show balance details" : "Hide balance details"
          }
          onClick={() => setIsCollapsed((prev) => !prev)}
        >
          {isCollapsed ? <PiCaretRight size={15} /> : <PiCaretDown size={15} />}
        </Button>
      }
    >
      {!isCollapsed && (
        <Box width="100%" overflow="auto">
          {latestPeriod && latestPeriod.leaves.length > 0 ? (
            <LatestPeriodBalanceTable
              latestPeriod={latestPeriod}
              variations={variations}
            />
          ) : (
            <VariationUsersTable
              users={users}
              variations={variations}
              srm={srm}
            />
          )}
        </Box>
      )}
      <Text as="div" color="text-low" mx="2" mt="1" mb="2">
        p-value: {pValueFormatter(srm, 4)}
      </Text>
      <div>
        <SRMWarningFooter
          srm={srm}
          srmHealth={srmHealth}
          variations={variations}
          users={users}
          isBandit
        />
      </div>
    </SRMCardShell>
  );
}

const unitFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// Show only leaf 0 by default.
const INITIAL_VISIBLE_LEAF_COUNT = 1;
const SHOW_MORE_LEAF_CHUNK_SIZE = 10;

/**
 * Actual vs. expected unit split per leaf & variation for the most recent
 * bandit period. Leaf 0 is shown by default; the remaining leaves are revealed
 * with "Show more...".
 */
function LatestPeriodBalanceTable({
  latestPeriod,
  variations,
}: {
  latestPeriod: ContextualBanditSrmLatestPeriod;
  variations: ExperimentReportVariation[];
}) {
  const [visibleLeafCount, setVisibleLeafCount] = useState(
    INITIAL_VISIBLE_LEAF_COUNT,
  );

  const leaves = useMemo(
    () =>
      [...latestPeriod.leaves].sort(
        (a, b) => Number(a.leafId) - Number(b.leafId),
      ),
    [latestPeriod.leaves],
  );

  const visibleLeaves = leaves.slice(0, visibleLeafCount);

  return (
    <>
      <Table variant="surface" mx="2" mb="2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Leaf</TableColumnHeader>
            <TableColumnHeader>Variation</TableColumnHeader>
            <TableColumnHeader justify="end">Actual Units</TableColumnHeader>
            <TableColumnHeader justify="end">Expected Units</TableColumnHeader>
            <TableColumnHeader justify="end">Actual %</TableColumnHeader>
            <TableColumnHeader justify="end">Expected %</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleLeaves.map((leaf) => {
            const totalObserved = leaf.observed.reduce((sum, n) => sum + n, 0);
            const totalExpected = leaf.expected.reduce((sum, n) => sum + n, 0);
            return variations.map((v, i) => (
              <TableRow key={`${leaf.leafId}-${v.id}`}>
                {i === 0 ? (
                  <TableRowHeaderCell rowSpan={variations.length}>
                    {leaf.leafId}
                  </TableRowHeaderCell>
                ) : null}
                <TableCell>
                  <VariationLabel number={v.index} name={v.name} />
                </TableCell>
                <TableCell justify="end">
                  <Text weight="semibold">
                    {unitFormatter.format(leaf.observed[i] ?? 0)}
                  </Text>
                </TableCell>
                <TableCell justify="end">
                  {unitFormatter.format(leaf.expected[i] ?? 0)}
                </TableCell>
                <TableCell justify="end">
                  <Text weight="semibold">
                    {totalObserved > 0
                      ? percentFormatter.format(
                          (leaf.observed[i] ?? 0) / totalObserved,
                        )
                      : "-"}
                  </Text>
                </TableCell>
                <TableCell justify="end">
                  {totalExpected > 0
                    ? percentFormatter.format(
                        (leaf.expected[i] ?? 0) / totalExpected,
                      )
                    : "-"}
                </TableCell>
              </TableRow>
            ));
          })}
        </TableBody>
      </Table>
      {visibleLeafCount < leaves.length && (
        <Box mx="2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setVisibleLeafCount((count) =>
                Math.min(count + SHOW_MORE_LEAF_CHUNK_SIZE, leaves.length),
              )
            }
          >
            Show more...
          </Button>
        </Box>
      )}
    </>
  );
}
