import { FC } from "react";
import { PiLightning, PiLightningSlash, PiWarningFill } from "react-icons/pi";
import { ago, datetime, getValidDate } from "shared/dates";
import { Text, Flex, IconButton } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";

const PARTIALLY_SUCCEEDED_STRING = `Some of the queries had an error. The partial results
                are displayed below.`;

const QueriesLastRun: FC<{
  status;
  dateCreated: Date | undefined;
  nextUpdate?: Date;
  autoUpdateEnabled?: boolean;
  partiallySucceededString?: string;
  queries?: string[];
  onViewQueries?: () => void;
  showAutoUpdateWidget?: boolean;
}> = ({
  status,
  dateCreated,
  nextUpdate,
  autoUpdateEnabled,
  partiallySucceededString = PARTIALLY_SUCCEEDED_STRING,
  queries,
  onViewQueries,
  showAutoUpdateWidget = true,
}) => {
  const abbreviatedAgo = ago(dateCreated ?? "")
    .replace("about ", "")
    .replace("less than a", "<1")
    .replace(/second(s)?/g, "sec$1")
    .replace(/minute(s)?/g, "min$1");

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

        <Tooltip
          body={
            <Flex direction="column">
              <Text>Last update: {datetime(dateCreated ?? "")}</Text>
              {nextUpdate && !showAutoUpdateWidget ? (
                <Text>Next update: {datetime(nextUpdate)}</Text>
              ) : null}
            </Flex>
          }
        >
          <Text weight="regular" style={{ color: "var(--color-text-mid)" }}>
            Updated {abbreviatedAgo}
          </Text>
        </Tooltip>

        {(status === "partially-succeeded" || status === "failed") && (
          <Tooltip body={partiallySucceededString}>
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
