import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import LinkedChange from "@/components/Experiment/LinkedChanges/LinkedChange";
import LinkedChangeVariationRows from "@/components/Experiment/LinkedChanges/LinkedChangeVariationRows";
import ForceSummary from "@/components/Features/ForceSummary";
import EnvironmentStatesGrid from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  open?: boolean;
};

export default function LinkedFeatureFlag({ info, experiment }: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const orderedValues = variations.map((v) => {
    return info.values.find((v2) => v2.variationId === v.id)?.value || "";
  });

  const environmentStates = Object.entries(info.environmentStates || {}).map(
    ([env, state]) => ({
      env,
      state,
      isActive: state === "active",
      tooltip:
        state === "active"
          ? "The experiment is active in this environment"
          : state === "disabled-env"
            ? "The environment is disabled for this feature, so the experiment is not active"
            : state === "disabled-rule"
              ? "The experiment is disabled in this environment and is not active"
              : "The experiment is not present in this environment",
    }),
  );

  return (
    <LinkedChange
      changeType={"flag"}
      heading={info.feature?.id || "Feature"}
      feature={info.feature}
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
      {info.state === "discarded" && (
        <Callout status="info" my="4">
          This experiment was linked to this feature in the past, but is no
          longer live.
        </Callout>
      )}
      {info.state === "draft" && (
        <Callout status="warning" my="4">
          Feature is in <strong>Draft</strong> mode and will not allow
          experiments to run. Publish Feature from the Feature Flag detail page
          to start.{" "}
          <Link href={`/features/${info.feature?.id}`}>
            Take me there <PiArrowSquareOut className="ml-1" />
          </Link>
        </Callout>
      )}
      {info.state !== "discarded" && (
        <Box className="appbox">
          <Flex width="100%" gap="4" py="4" px="5" direction="column">
            <Box flexGrow="1">
              <LinkedChangeVariationRows
                alignContent={
                  info.feature.valueType === "json" ? "start" : "center"
                }
                experiment={experiment}
                renderContent={(j) => (
                  <ForceSummary
                    value={orderedValues[j]}
                    feature={info.feature}
                    maxHeight={60}
                  />
                )}
              />
            </Box>

            {(info.state === "live" || info.state === "draft") && (
              <>
                {info.inconsistentValues && (
                  <Callout status="warning">
                    <strong>Warning:</strong> This experiment is included
                    multiple times with different values. The values above are
                    from the first matching experiment in{" "}
                    <strong>{info.valuesFrom}</strong>.
                  </Callout>
                )}

                {info.rulesAbove && (
                  <Callout status="info">
                    <strong>Notice:</strong> There are feature rules above this
                    experiment so some users might not be included.
                  </Callout>
                )}
              </>
            )}
          </Flex>

          {info.state !== "locked" && (
            <>
              <Separator size="4" />
              <EnvironmentStatesGrid environmentStates={environmentStates} />
            </>
          )}
        </Box>
      )}
    </LinkedChange>
  );
}
