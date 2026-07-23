import { useEffect, useMemo } from "react";
import { ExperimentReportVariation } from "shared/types/report";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import SRMWarning from "@/components/Experiment/SRMWarning";
import Callout from "@/ui/Callout";
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
        </p>
        <hr className="mb-0" />
        <div style={{ paddingTop: "10px" }}>
          <div className="row justify-content-start w-100 overflow-auto">
            <VariationUsersTable
              users={users}
              variations={variations}
              srm={srm}
            />
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
          {srmHealth !== "not-enough-traffic" &&
          latestPeriod &&
          latestPeriod.leaves.length > 0 ? (
            <LatestPeriodBreakdown
              latestPeriod={latestPeriod}
              variations={variations}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Observed vs expected units per leaf & variation for the most recent bandit
 * period only. This is illustrative context for the balance check — it does NOT
 * reconcile to the SRM p-value above.
 */
function LatestPeriodBreakdown({
  latestPeriod,
  variations,
}: {
  latestPeriod: ContextualBanditSrmLatestPeriod;
  variations: ExperimentReportVariation[];
}) {
  const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);
  const expectedFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    [],
  );

  return (
    <div className="mt-4">
      <h4 className="mb-1">Most recent period breakdown</h4>
      <Text as="p" size="small" color="text-low" mb="2">
        Observed vs. expected units per leaf and variation for the latest weight
        update
        {latestPeriod.banditVersion ? ` (${latestPeriod.banditVersion})` : ""}.
        Shown for context only — these counts don&apos;t reconcile with the
        p-value above, which spans the bandit&apos;s full history.
      </Text>
      <Table variant="surface">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Leaf</TableColumnHeader>
            {variations.map((v) => (
              <TableColumnHeader key={v.id} align="right">
                {v.name} (obs / exp)
              </TableColumnHeader>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {latestPeriod.leaves.map((leaf) => (
            <TableRow key={leaf.leafId}>
              <TableRowHeaderCell>{leaf.leafId}</TableRowHeaderCell>
              {variations.map((v, i) => (
                <TableCell key={v.id} align="right">
                  {numberFormatter.format(leaf.observed[i] ?? 0)}
                  {" / "}
                  {expectedFormatter.format(leaf.expected[i] ?? 0)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
