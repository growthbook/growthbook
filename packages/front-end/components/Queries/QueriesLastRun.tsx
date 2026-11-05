import { FC } from "react";
import { PiLightning, PiLightningSlash, PiWarningFill } from "react-icons/pi";
import {
  ago,
  datetime,
  datetimeAt,
  getValidDate,
  abbreviateAgo,
} from "shared/dates";
import { Text, Flex, Box, IconButton } from "@radix-ui/themes";
import { QueryStatus } from "shared/types/query";
import { SourceSnapshotRef } from "shared/enterprise";
import Tooltip from "@/components/Tooltip/Tooltip";
import { getResultsFreshness, ResultsFreshness } from "@/services/snapshots";

const FAILED_STRING = `The most recent update failed. Click to view queries.`;
const PARTIALLY_SUCCEEDED_STRING = `Some of the queries had an error. The partial results
                are displayed below.`;

const AS_OF_ROW_LABELS: Record<
  Exclude<ResultsFreshness["kind"], "updated">,
  { ranAt: string; asOf: string }
> = {
  derived: {
    ranAt: "Dimension Computed",
    asOf: "Results as of (from Overall Results)",
  },
  cutoff: { ranAt: "Last updated", asOf: "Results as of" },
};

const QueriesLastRun: FC<{
  status: QueryStatus;
  dateCreated?: Date;
  // The data cutoff, when the snapshot analyzed through one
  cutoffDate?: Date | null;
  sourceSnapshot?: SourceSnapshotRef;
  nextUpdate?: Date;
  latestQueryDate?: Date;
  autoUpdateEnabled?: boolean;
  failedString?: string;
  partiallySucceededString?: string;
  queries?: string[];
  onViewQueries?: () => void;
  showAutoUpdateWidget?: boolean;
}> = ({
  status,
  dateCreated,
  cutoffDate,
  sourceSnapshot,
  nextUpdate,
  latestQueryDate,
  autoUpdateEnabled,
  failedString,
  partiallySucceededString = PARTIALLY_SUCCEEDED_STRING,
  queries,
  onViewQueries,
  showAutoUpdateWidget = true,
}) => {
  const freshness = getResultsFreshness({
    dateCreated,
    cutoffDate,
    sourceSnapshot,
  });

  const _failedString =
    failedString ||
    (latestQueryDate
      ? `The most recent update (${abbreviateAgo(latestQueryDate)}) failed. Click to view queries.`
      : FAILED_STRING);

  return (
    <Text weight="medium">
      <Flex align="center">
        {showAutoUpdateWidget && autoUpdateEnabled ? (
          <Tooltip
            className="mr-1"
            body={
              <Text>
                {!nextUpdate
                  ? "Next auto-update: never"
                  : nextUpdate && getValidDate(nextUpdate) > new Date()
                    ? `Next auto-update ${ago(nextUpdate)}`
                    : "Auto-update starting soon"}
              </Text>
            }
          >
            <PiLightning size={18} style={{ color: "var(--violet-11)" }} />
          </Tooltip>
        ) : (
          <Tooltip
            className="mr-1"
            body={<Text>Auto-updates are disabled.</Text>}
          >
            <PiLightningSlash size={18} style={{ color: "var(--gray-8)" }} />
          </Tooltip>
        )}

        {freshness ? (
          <Tooltip
            body={
              <Flex direction="column">
                {freshness.kind === "updated" ? (
                  <Text>Last update: {datetime(freshness.ranAt)}</Text>
                ) : (
                  <Flex direction="column" gap="3">
                    <Box>
                      <Text as="div" weight="bold">
                        {AS_OF_ROW_LABELS[freshness.kind].ranAt}
                      </Text>
                      <Text as="div">{datetimeAt(freshness.ranAt)}</Text>
                    </Box>
                    <Box>
                      <Text as="div" weight="bold">
                        {AS_OF_ROW_LABELS[freshness.kind].asOf}
                      </Text>
                      <Text as="div">{datetimeAt(freshness.asOf)}</Text>
                    </Box>
                  </Flex>
                )}
                {nextUpdate && !showAutoUpdateWidget ? (
                  <Text>Next update: {datetime(nextUpdate)}</Text>
                ) : null}
              </Flex>
            }
          >
            <Text weight="regular" style={{ color: "var(--color-text-mid)" }}>
              {freshness.kind === "updated"
                ? `Updated ${abbreviateAgo(freshness.ranAt)}`
                : `Results as of ${abbreviateAgo(freshness.asOf)}`}
            </Text>
          </Tooltip>
        ) : (
          <Tooltip
            body={<Text>Next update: {datetime(nextUpdate ?? "")}</Text>}
            shouldDisplay={nextUpdate && !showAutoUpdateWidget}
          >
            <Text weight="regular" style={{ color: "var(--color-text-mid)" }}>
              Not updated yet
            </Text>
          </Tooltip>
        )}

        {(status === "partially-succeeded" || status === "failed") && (
          <Tooltip
            body={
              status === "failed" ? _failedString : partiallySucceededString
            }
          >
            {onViewQueries && queries && queries.length > 0 ? (
              <IconButton
                variant="ghost"
                color="red"
                radius="full"
                onClick={onViewQueries}
                ml="1"
                style={{ marginTop: "auto", marginBottom: "auto" }}
              >
                <PiWarningFill size={18} />
              </IconButton>
            ) : (
              <Text color="red" ml="1">
                <PiWarningFill size={18} />
              </Text>
            )}
          </Tooltip>
        )}
      </Flex>
    </Text>
  );
};
export default QueriesLastRun;
