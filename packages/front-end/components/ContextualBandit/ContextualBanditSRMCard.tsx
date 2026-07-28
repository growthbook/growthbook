import { useEffect, useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import { ExperimentReportVariation } from "shared/types/report";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "@/components/Experiment/SRMWarning";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import VariationLabel from "@/ui/VariationLabel";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import { StatusBadge } from "@/components/HealthTab/StatusBadge";
import { IssueValue } from "@/components/HealthTab/IssueTags";

export type ContextualBanditSrmLatestPeriod = {
  banditVersion: string;
  leaves: { leafId: string; observed: number[]; expected: number[] }[];
};

interface Props {
  srm: number | null;
  variations: ExperimentReportVariation[];
  users: number[];
  totalUsers: number;
  latestPeriod?: ContextualBanditSrmLatestPeriod | null;
  onNotify?: (issue: IssueValue) => void;
}

export default function ContextualBanditSRMCard({
  srm,
  variations,
  users,
  totalUsers,
  latestPeriod,
  onNotify,
}: Props) {
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const srmHealth = useMemo(
    () =>
      getSRMHealthData({
        srm: srm ?? Infinity,
        srmThreshold,
        numOfVariations: variations.length,
        totalUsersCount: totalUsers,
        minUsersPerVariation: DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
      }),
    [srm, srmThreshold, variations.length, totalUsers],
  );

  useEffect(() => {
    if (srmHealth === "unhealthy" && onNotify) {
      onNotify({ label: "Experiment Balance", value: "balanceCheck" });
    }
  }, [srmHealth, onNotify]);

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
    <div className="appbox container-fluid my-4 pl-3 py-3">
      <div className="overflow-auto">
        <h2 className="d-inline">Balance Check</h2>{" "}
        {srmHealth !== "healthy" && <StatusBadge status={srmHealth} />}
        <p className="mt-1">
          Shows the actual unit split compared to the assigned variation weights
          for the most recent bandit period, broken down by leaf
        </p>
        <hr className="mb-0" />
        <div style={{ paddingTop: "10px" }}>
          <div className="w-100 overflow-auto">
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
          </div>
          <div className="text-muted mx-2 mt-1 mb-2">
            p-value = {pValueFormatter(srm)}
          </div>
          <div>
            {srmHealth !== "not-enough-traffic" ? (
              <SRMWarning
                srm={srm}
                variations={variations}
                users={users}
                showWhenHealthy
                isBandit
              />
            ) : (
              <Callout status="info">
                More traffic is required to detect a Sample Ratio Mismatch
                (SRM).
              </Callout>
            )}
          </div>
        </div>
      </div>
    </div>
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
                  <b>{unitFormatter.format(leaf.observed[i] ?? 0)}</b>
                </TableCell>
                <TableCell justify="end">
                  {unitFormatter.format(leaf.expected[i] ?? 0)}
                </TableCell>
                <TableCell justify="end">
                  <b>
                    {totalObserved > 0
                      ? percentFormatter.format(
                          (leaf.observed[i] ?? 0) / totalObserved,
                        )
                      : "-"}
                  </b>
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
            size="xs"
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
