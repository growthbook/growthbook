import { FC } from "react";
import { PiWarningFill } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { Text, Flex, IconButton, Box } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";

const PARTIALLY_SUCCEEDED_STRING = `Some of the queries had an error. The partial results
                are displayed below.`;

const QueriesLastRun: FC<{
  status;
  dateCreated: Date | undefined;
  nextUpdate?: Date;
  partiallySucceededString?: string;
  queries?: string[];
  onViewQueries?: () => void;
}> = ({
  status,
  dateCreated,
  nextUpdate,
  partiallySucceededString = PARTIALLY_SUCCEEDED_STRING,
  queries,
  onViewQueries,
}) => {
  const abbreviatedAgo = ago(dateCreated ?? "")
    .replace("about ", "")
    .replace("less than a", "<1")
    .replace(/second(s)?/g, "sec$1")
    .replace(/minute(s)?/g, "min$1");

  return (
    <Text weight="medium">
      <Flex align="center">
        <Tooltip
          body={
            <Flex direction="column">
              <Text>Last update: {datetime(dateCreated ?? "")}</Text>
              {nextUpdate && <Text>Next update: {datetime(nextUpdate)}</Text>}
            </Flex>
          }
        >
          <Text weight="regular" style={{ color: "var(--color-text-mid)" }}>
            Updated {abbreviatedAgo}
          </Text>
        </Tooltip>

        {(status === "partially-succeeded" || status === "failed") && (
          <Tooltip
            body={
              <>
                {partiallySucceededString}
                {onViewQueries && queries && queries.length > 0 && (
                  <Box mt="2">
                    <Text color="red">Click to view queries...</Text>
                  </Box>
                )}
              </>
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
