import { StaleFeatureReason } from "shared/util";
import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { ago, datetime } from "shared/dates";
import {
  PiTimerBold,
  PiArrowClockwise,
  PiLightning,
  PiAsteriskBold,
} from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
  "never-stale": "Stale detection is disabled.",
  "recently-updated": "Updated within the last two weeks.",
  "active-draft": "Active draft in progress.",
  "has-dependents": "Used by a non-stale dependent feature or experiment.",
  "no-rules": "No rules defined.",
  "rules-one-sided": "All reachable rules are one-sided.",
  "abandoned-draft": "Draft not updated in over a month.",
  "toggled-off": "Environment is disabled.",
  "active-experiment": "Live experiment rule in this environment.",
  "has-rules": "Has rules with targeting conditions.",
  error: "Error evaluating staleness.",
};

export default function StaleFeatureIcon({
  isStale,
  staleReason,
  staleByEnv,
  staleLastCalculated,
  valueType,
  showNonStaleStatuses = false,
  onRerun,
  onDisable,
}: {
  isStale: boolean;
  staleReason: StaleFeatureReason | undefined;
  staleByEnv?: FeatureInterface["staleByEnv"];
  staleLastCalculated?: Date | string | null;
  valueType?: FeatureValueType;
  showNonStaleStatuses?: boolean;
  onRerun?: () => void;
  onDisable?: () => void;
}) {
  const hasSomeStaleEnvs = Object.values(staleByEnv ?? {}).some(
    (e) => e.isStale,
  );

  const mixed = !isStale && hasSomeStaleEnvs;
  const fresh = !isStale && !hasSomeStaleEnvs;

  if (!isStale && !showNonStaleStatuses) return null;

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
            <span style={{ color: "var(--green-10)" }}>
              <Text size="large" weight="semibold">
                Not Stale
              </Text>
            </span>
          )}
          {mixed && (
            <Text as="div" size="medium" color="text-low">
              <PiAsteriskBold
                size={10}
                color="var(--gray-11)"
                style={{ verticalAlign: 0 }}
              />{" "}
              Some environments may be stale
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

            <table
              className="table table-sm table-valign-top mt-2"
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
                        <span style={{ color: "var(--green-10)" }}>
                          <Text weight="semibold">Not Stale</Text>
                        </span>
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
      {(onRerun || onDisable || staleLastCalculated) && (
        <Flex direction="column" align="end" gap="2" mt="2">
          <Flex gap="1" align="center">
            <Tooltip body="Updates every 24 hours" tipPosition="top">
              <PiLightning style={{ color: "var(--violet-11)" }} />
            </Tooltip>
            {staleLastCalculated && (
              <Tooltip
                body={`Last run: ${datetime(staleLastCalculated)}`}
                tipPosition="top"
              >
                <Text size="small" color="text-low">
                  Last run: {ago(new Date(staleLastCalculated))}
                </Text>
              </Tooltip>
            )}
          </Flex>
          {(onRerun || onDisable) && (
            <Flex gap="2">
              {onRerun && (
                <Button size="xs" variant="outline" onClick={onRerun}>
                  <PiArrowClockwise /> Re-run
                </Button>
              )}
              {onDisable && (
                <Button
                  size="xs"
                  color="red"
                  variant="outline"
                  onClick={onDisable}
                >
                  Disable stale detection
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      )}
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
        className={
          fresh
            ? styles.freshIcon
            : mixed
              ? styles.staleFadedIcon
              : styles.staleIcon
        }
      />
    </Tooltip>
  );
}
