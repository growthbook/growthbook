import { StaleFeatureReason } from "shared/util";
import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { PiTimerBold } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
  "never-stale": "Stale detection is disabled.",
  "recently-updated": "Updated within the last two weeks.",
  "active-draft": "Active draft in progress.",
  "has-dependents": "Used by a non-stale dependent feature or experiment.",
  "no-rules": "No rules defined.",
  "rules-one-sided": "All rules are one-sided.",
  "abandoned-draft": "Draft not updated in over a month.",
  "toggled-off": "Environment is disabled.",
  error: "Error evaluating staleness.",
};

export default function StaleFeatureIcon({
  isStale,
  staleReason,
  staleByEnv,
  valueType,
  onClick,
}: {
  isStale: boolean;
  staleReason: StaleFeatureReason | undefined;
  staleByEnv?: FeatureInterface["staleByEnv"];
  valueType?: FeatureValueType;
  onClick: () => void;
}) {
  const hasSomeStaleEnvs = Object.values(staleByEnv ?? {}).some(
    (e) => e.isStale,
  );

  if (!isStale && !hasSomeStaleEnvs) return null;

  const mixed = !isStale && hasSomeStaleEnvs;

  const envEntries = Object.entries(staleByEnv ?? {});

  const body = (
    <Box>
      <Flex direction="column" gap="4">
        <Box>
          <Text
            as="div"
            size="small"
            weight="semibold"
            color="text-mid"
            textTransform="uppercase"
            mb="1"
          >
            Overall Status
          </Text>
          {isStale ? (
            <span style={{ color: "var(--yellow-11)" }}>
              <Text size="large" weight="semibold">
                Stale
              </Text>
            </span>
          ) : (
            <Text size="large" color="text-low" weight="semibold">
              Not Stale
            </Text>
          )}
        </Box>

        {staleReason && (
          <Box>
            <Text
              as="div"
              size="small"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
              mb="1"
            >
              Reason
            </Text>
            <Text size="medium" as="div">
              {staleReasonToMessageMap[staleReason]}
            </Text>
          </Box>
        )}

        {envEntries.length > 0 && (
          <Box mt="4">
            <Text
              as="div"
              size="small"
              weight="semibold"
              color="text-mid"
              textTransform="uppercase"
            >
              Environment Statuses
            </Text>
            <Text size="small" color="text-low" mt="1">
              Environment statuses are informational and may not fully reflect
              the feature&apos;s current stale state.
            </Text>

            <table
              className="table table-sm table-valign-top mt-3"
              style={{ tableLayout: "fixed" }}
            >
              <thead>
                <tr>
                  <th style={{ width: "20%" }} />
                  <th style={{ width: "15%" }}>Status</th>
                  <th style={{ width: "25%" }}>Reason</th>
                  <th>Evaluates to</th>
                </tr>
              </thead>
              <tbody>
                {envEntries.map(([envId, info]) => (
                  <tr key={envId} style={{ verticalAlign: "top" }}>
                    <td style={{ overflow: "hidden" }}>
                      <Text
                        size="medium"
                        weight="medium"
                        truncate
                        title={envId}
                      >
                        {envId}
                      </Text>
                    </td>
                    <td>
                      {info.isStale ? (
                        <span style={{ color: "var(--yellow-11)" }}>
                          <Text weight="semibold">Stale</Text>
                        </span>
                      ) : (
                        <Text color="text-low" weight="semibold">
                          Not Stale
                        </Text>
                      )}
                    </td>
                    <td>
                      <Text size="small" color="text-mid">
                        {info.reason
                          ? (staleReasonToMessageMap[
                              info.reason as StaleFeatureReason
                            ] ?? info.reason)
                          : null}
                      </Text>
                    </td>
                    <td>
                      {info.evaluatesTo !== undefined && valueType && (
                        <ValueDisplay
                          value={info.evaluatesTo}
                          type={valueType}
                          fullStyle={{
                            maxHeight: 80,
                            overflowY: "auto",
                            maxWidth: "100%",
                          }}
                        />
                      )}
                      {info.evaluatesTo !== undefined && !valueType && (
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.85em",
                          }}
                        >
                          {info.evaluatesTo}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}
      </Flex>
    </Box>
  );

  return (
    <Tooltip
      popperClassName="text-left"
      popperStyle={{ maxWidth: 600 }}
      body={body}
      flipTheme={false}
    >
      <PiTimerBold
        size={18}
        onClick={onClick}
        className={mixed ? styles.staleFadedIcon : styles.staleIcon}
      />
    </Tooltip>
  );
}
