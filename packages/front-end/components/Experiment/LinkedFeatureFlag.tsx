import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheckCircleFill, PiWarningFill } from "react-icons/pi";
import LinkedChange from "@/components/Experiment/LinkedChange";
import Tooltip from "@/components/Tooltip/Tooltip";
import ForceSummary from "@/components/Features/ForceSummary";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  open?: boolean;
};

export default function LinkedFeatureFlag({ info, experiment, open }: Props) {
  const orderedValues = experiment.variations.map((v) => {
    return info.values.find((v2) => v2.variationId === v.id)?.value || "";
  });

  return (
    <LinkedChange
      changeType={"flag"}
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
      open={open ?? experiment.status === "draft"}
    >
      <Box mt="2">
        <Flex width="100%" gap="4">
          {info.state !== "locked" && info.state !== "discarded" && (
            <Box width="33%">
              <Heading weight="semibold" as="h4" size="small">
                Environments
              </Heading>
              <Flex direction="column" gap="2">
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
                        <Flex gap="3" display="inline-flex">
                          <Box
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
                          <Box>{env}</Box>
                        </Flex>
                      </Tooltip>
                    </Box>
                  ),
                )}
              </Flex>
            </Box>
          )}
          {info.state !== "discarded" && (
            <Box flexGrow="1">
              <Heading weight="semibold" as="h4" size="small">
                Feature values
              </Heading>
              <Box>
                {orderedValues.map((v, j) => (
                  <Flex
                    justify="between"
                    width="100%"
                    key={j}
                    gap="4"
                    py="2"
                    my="2"
                    style={{ borderBottom: "1px solid var(--slate-a4)" }}
                  >
                    <Flex
                      align="center"
                      gap="2"
                      flexBasis="30%"
                      flexShrink="0"
                      className={`variation with-variation-label border-right-0 variation${j}`}
                    >
                      <span className="label" style={{ width: 20, height: 20 }}>
                        {j}
                      </span>
                      <span
                        className="d-inline-block text-ellipsis"
                        title={experiment.variations[j]?.name}
                      >
                        {experiment.variations[j]?.name}
                      </span>
                    </Flex>
                    <Box flexGrow="1">
                      <ForceSummary value={v} feature={info.feature} />
                    </Box>
                  </Flex>
                ))}
              </Box>
            </Box>
          )}
        </Flex>

        {info.state === "discarded" && (
          <Callout status="info">
            This experiment was linked to this feature in the past, but is no
            longer live.
          </Callout>
        )}

        {(info.state === "live" || info.state === "draft") && (
          <>
            {info.inconsistentValues && (
              <Callout status="warning" mt="4">
                <strong>Warning:</strong> This experiment is included multiple
                times with different values. The values above are from the first
                matching experiment in <strong>{info.valuesFrom}</strong>.
              </Callout>
            )}

            {info.rulesAbove && (
              <Callout status="info" mt="4">
                <strong>Notice:</strong> There are feature rules above this
                experiment so some users might not be included.
              </Callout>
            )}
          </>
        )}
      </Box>
    </LinkedChange>
  );
}
