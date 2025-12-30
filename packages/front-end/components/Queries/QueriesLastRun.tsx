import { FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { ago, datetime } from "shared/dates";
import { Text, Flex } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";

const PARTIALLY_SUCCEEDED_STRING = `Some of the queries had an error. The partial results
                are displayed below.`;

const QueriesLastRun: FC<{
  status;
  dateCreated: Date | undefined;
  nextUpdate?: Date;
  partiallySucceededString?: string;
}> = ({
  status,
  dateCreated,
  nextUpdate,
  partiallySucceededString = PARTIALLY_SUCCEEDED_STRING,
}) => {
  return (
    <div style={{ fontSize: "12px" }}>
      <div
        style={{
          lineHeight: 1.2,
        }}
      >
        <Tooltip
          content={
            <Flex direction="column">
              <Text>Last update: {datetime(dateCreated ?? "")}</Text>
              {nextUpdate && <Text>Next update: {datetime(nextUpdate)}</Text>}
            </Flex>
          }
        >
          <Text weight="medium" style={{ color: "var(--color-text-mid)" }}>
            Updated {ago(dateCreated ?? "")}
          </Text>
        </Tooltip>

        {status === "partially-succeeded" && (
          <Tooltip content={partiallySucceededString}>
            <span>
              <FaExclamationTriangle
                size={14}
                className="text-danger ml-1"
                style={{ marginTop: -4 }}
              />
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
export default QueriesLastRun;
