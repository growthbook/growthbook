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
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Features/RevisionStatusBadge";
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
      additionalBadge={(() => {
        // Mirror the FF-side palette (see RevisionStatusBadge).
        const revisionStatus =
          info.state === "live"
            ? "live"
            : info.state === "draft"
              ? "draft"
              : info.state === "locked"
                ? "published"
                : info.state === "discarded"
                  ? "discarded"
                  : null;
        if (!revisionStatus) return null;
        return (
          <Badge
            label={revisionStatusLabel(revisionStatus)}
            radius="full"
            color={revisionStatusColor(revisionStatus)}
          />
        );
      })()}
    >
      {info.state === "discarded" && (
        <Callout status="info" my="4">
          This experiment was linked to this feature in the past, but is no
          longer live.
        </Callout>
      )}
      {info.state === "draft" && (
        <Callout status="info" my="4">
          Rule changes for this feature are sitting in a <strong>draft</strong>{" "}
          revision. They will be auto-published when this experiment starts, or
          you can publish manually now from the{" "}
          <Link href={`/features/${info.feature?.id}`} target="_blank">
            Feature Flag detail page <PiArrowSquareOut className="ml-1" />
          </Link>
          .
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
