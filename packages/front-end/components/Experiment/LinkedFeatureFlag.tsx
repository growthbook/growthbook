import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { Box, Flex, Grid, IconButton, Separator } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckCircleFill,
  PiWarningFill,
} from "react-icons/pi";
import { useState } from "react";
import LinkedChange from "@/components/Experiment/LinkedChange";
import Tooltip from "@/components/Tooltip/Tooltip";
import ForceSummary from "@/components/Features/ForceSummary";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { decimalToPercent } from "@/services/utils";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  open?: boolean;
};

export default function LinkedFeatureFlag({ info, experiment, open }: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  const orderedValues = variations.map((v) => {
    return info.values.find((v2) => v2.variationId === v.id)?.value || "";
  });
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const activeEnvironmentCount = Object.values(
    info.environmentStates || {},
  ).filter((state) => state === "active").length;
  const totalEnvironmentCount = Object.keys(
    info.environmentStates || {},
  ).length;
  const valueType = info.feature?.valueType;

  return (
    <LinkedChange
      changeType={"flag"}
      heading={info.feature?.id || "Feature"}
      feature={info.feature}
      state={info.state}
      additionalBadge={
        info.state === "live" ? (
          <Badge label="Live" radius="full" color="teal" />
        ) : info.state === "draft" ? (
          <Badge label="Draft" radius="full" color="indigo" />
        ) : info.state === "locked" ? (
          <Badge label="Locked" radius="full" color="gray" />
        ) : info.state === "discarded" ? (
          <Badge label="Discarded" radius="full" color="red" />
        ) : null
      }
    >
      <Box className="appbox">
        <Flex width="100%" gap="4" py="4" px="5" direction="column">
          {info.state !== "discarded" && (
            <Box flexGrow="1">
              {orderedValues.map((v, j) => (
                <>
                  <Flex
                    align="start"
                    justify="between"
                    width="100%"
                    key={j}
                    gap="9"
                    style={{
                      height: valueType === "json" ? "60px" : "24px",
                    }}
                  >
                    <Flex
                      align="center"
                      gap="2"
                      flexBasis="15%"
                      flexShrink="0"
                      className={`variation with-variation-label border-right-0 variation${j}`}
                    >
                      <span className="label" style={{ width: 20, height: 20 }}>
                        {j}
                      </span>
                      <Box
                        as="span"
                        className="d-inline-block text-ellipsis"
                        title={variations[j]?.name}
                      >
                        <Text weight="semibold">{variations[j]?.name}</Text>
                      </Box>
                    </Flex>
                    <Box>
                      <Text>
                        {decimalToPercent(
                          latestPhase?.variationWeights?.[j] ?? 0,
                        )}
                        % Split
                      </Text>
                    </Box>
                    <Box flexGrow="1">
                      <ForceSummary
                        value={v}
                        feature={info.feature}
                        maxHeight={60}
                      />
                    </Box>
                  </Flex>
                  {j < orderedValues.length - 1 && (
                    <Separator size="4" mt="2" mb="3" />
                  )}
                </>
              ))}
            </Box>
          )}
          {info.state === "discarded" && (
            <Callout status="info">
              This experiment was linked to this feature in the past, but is no
              longer live.
            </Callout>
          )}

          {(info.state === "live" || info.state === "draft") && (
            <>
              {info.inconsistentValues && (
                <Callout status="warning" mb="4">
                  <strong>Warning:</strong> This experiment is included multiple
                  times with different values. The values above are from the
                  first matching experiment in{" "}
                  <strong>{info.valuesFrom}</strong>.
                </Callout>
              )}

              {info.rulesAbove && (
                <Callout status="info" mb="4">
                  <strong>Notice:</strong> There are feature rules above this
                  experiment so some users might not be included.
                </Callout>
              )}
            </>
          )}
        </Flex>

        <Separator size="4" />
        {info.state !== "locked" && info.state !== "discarded" && (
          <Box p="4" px="5">
            <Flex align="center">
              <Text color="text-low" weight="semibold" size="medium">
                Environments
              </Text>
              <Text color="text-low" size="medium" ml="1">
                ({activeEnvironmentCount}/{totalEnvironmentCount})
              </Text>
              <IconButton
                type="button"
                radius="full"
                ml="2"
                variant="ghost"
                onClick={() => {
                  setEnvironmentsOpen((prev) => !prev);
                }}
              >
                {environmentsOpen ? <PiCaretDown /> : <PiCaretRight />}
              </IconButton>
            </Flex>
            {environmentsOpen && (
              <Grid
                mt="3"
                gap="2"
                gapX="9"
                justify="between"
                flow="column"
                rows={
                  totalEnvironmentCount >= 5
                    ? "5"
                    : totalEnvironmentCount.toString()
                }
                display="inline-grid"
              >
                {Object.entries(info.environmentStates || {}).map(
                  ([env, state]) => (
                    <Box key={env}>
                      <Tooltip
                        body={
                          state === "active"
                            ? "The experiment is active in this environment"
                            : state === "disabled-env"
                              ? "The environment is disabled for this feature, so the experiment is not active"
                              : state === "disabled-rule"
                                ? "The experiment is disabled in this environment and is not active"
                                : "The experiment is not present in this environment"
                        }
                      >
                        <Flex gap="2" align="center" style={{ minWidth: 0 }}>
                          <Box
                            flexShrink="0"
                            style={{
                              color:
                                state === "active"
                                  ? "var(--green-11)"
                                  : "var(--amber-11)",
                            }}
                          >
                            {state === "active" ? (
                              <PiCheckCircleFill />
                            ) : (
                              <PiWarningFill />
                            )}
                          </Box>
                          <Box className="text-ellipsis" title={env}>
                            <Text weight="medium">{env}</Text>
                          </Box>
                        </Flex>
                      </Tooltip>
                    </Box>
                  ),
                )}
              </Grid>
            )}
          </Box>
        )}
      </Box>
    </LinkedChange>
  );
}
