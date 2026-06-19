import { useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiGitMerge, PiXBold } from "react-icons/pi";
import LinkedChange from "@/components/Experiment/LinkedChanges/LinkedChange";
import LinkedChangeVariationRows from "@/components/Experiment/LinkedChanges/LinkedChangeVariationRows";
import ForceSummary from "@/components/Features/ForceSummary";
import EnvironmentStatesGrid from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditFeatureFlagValuesModal from "@/components/Experiment/LinkedChanges/EditFeatureFlagValuesModal";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  onReAdd?: () => void;
  mutate?: () => void;
};

export default function LinkedFeatureFlag({
  info,
  experiment,
  numLinkedChanges,
  onReAdd,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [removing, setRemoving] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  const canUpdateLinkedFeature =
    canEditExperiment && permissionsUtil.canUpdateFeature(info.feature, {});

  const canEditFeatureDraft =
    canUpdateLinkedFeature &&
    permissionsUtil.canManageFeatureDrafts(info.feature);

  // Gates the "Re-add feature flag" link in the discarded callout: requires
  // feature-draft perms AND the experiment to still be in draft status with no
  // scheduled launch (post-launch, re-adding the rule isn't allowed).
  const canAddLinkedChanges =
    canEditFeatureDraft &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate;

  const handleRemove = async () => {
    if (!confirm("Remove this feature flag from the experiment?")) return;
    setRemoving(true);
    try {
      await apiCall(
        `/experiment/${experiment.id}/linked-feature/${info.feature.id}`,
        {
          method: "DELETE",
        },
      );
      mutate?.();
    } finally {
      setRemoving(false);
    }
  };

  // Shared icon for "draft cannot be auto-published" callouts (merge
  // conflicts and unrelated draft edits).
  const blockedAutoPublishIcon = (
    <Box position="relative" style={{ width: "1.2em", height: "1.2em" }}>
      <PiGitMerge
        style={{
          position: "absolute",
          top: -2,
          left: 0,
          fontSize: "1.2em",
        }}
      />
      <PiXBold
        style={{
          position: "absolute",
          bottom: "-4px",
          right: "-3px",
          fontSize: "0.75em",
        }}
      />
    </Box>
  );

  const variations = getLatestPhaseVariations(experiment);
  const configuredVariationIds = new Set(info.values.map((v) => v.variationId));
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

  const showEditButton =
    canEditFeatureDraft &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    info.state !== "discarded" &&
    info.state !== "locked" &&
    info.state !== "archived";

  return (
    <>
      {editModalOpen && (
        <EditFeatureFlagValuesModal
          feature={info.feature}
          experiment={experiment}
          linkedFeatureInfo={info}
          numLinkedChanges={numLinkedChanges}
          close={() => setEditModalOpen(false)}
          mutate={() => mutate?.()}
        />
      )}
      <LinkedChange
        changeType={"flag"}
        heading={info.feature?.id || "Feature"}
        feature={info.feature}
        canEdit={showEditButton}
        onEdit={showEditButton ? () => setEditModalOpen(true) : undefined}
        additionalBadge={(() => {
          if (info.state === "archived") {
            return <Badge label="Archived" radius="full" color="gray" />;
          }
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
        {info.state === "archived" && (
          <Callout status="warning" my="4">
            This feature flag has been archived. Unarchive it to make this
            experiment active.
          </Callout>
        )}
        {info.state === "discarded" && (
          <Callout status="warning" my="4">
            The draft revision linking this experiment was discarded. The
            experiment-ref rule is no longer queued.{" "}
            {canAddLinkedChanges && onReAdd ? (
              <Link onClick={onReAdd} style={{ cursor: "pointer" }}>
                Re-add feature flag
              </Link>
            ) : (
              <Link href={`/features/${info.feature?.id}`} target="_blank">
                Go to feature page <PiArrowSquareOut className="ml-1" />
              </Link>
            )}
            {canUpdateLinkedFeature && (
              <>
                {" · "}
                <Link
                  onClick={handleRemove}
                  style={{ cursor: removing ? "wait" : "pointer" }}
                >
                  Remove from experiment
                </Link>
              </>
            )}
          </Callout>
        )}
        {info.state === "draft" && info.hasMergeConflict && (
          <Callout status="error" my="4" icon={blockedAutoPublishIcon}>
            This feature draft has a <strong>merge conflict</strong> and cannot
            be auto-published.{" "}
            <Link
              href={`/features/${info.feature?.id}${info.draftRevisionVersion != null ? `?v=${info.draftRevisionVersion}` : ""}`}
              target="_blank"
            >
              Fix conflicts
              <PiArrowSquareOut className="ml-1" />
            </Link>
          </Callout>
        )}
        {info.state === "draft" &&
          !info.hasMergeConflict &&
          info.hasUnrelatedDraftChanges && (
            <Callout status="error" my="4" icon={blockedAutoPublishIcon}>
              This feature draft contains{" "}
              <strong>changes beyond this experiment</strong> and cannot be
              auto-published. Either remove the unrelated edits from the draft
              or publish the full draft manually.{" "}
              <Link
                href={`/features/${info.feature?.id}${info.draftRevisionVersion != null ? `?v=${info.draftRevisionVersion}` : ""}`}
                target="_blank"
              >
                Review draft
                <PiArrowSquareOut className="ml-1" />
              </Link>
            </Callout>
          )}
        {info.state === "draft" &&
          !info.hasMergeConflict &&
          !info.hasUnrelatedDraftChanges && (
            <Callout
              status="info"
              my="4"
              icon={<PiGitMerge style={{ fontSize: "1.2em" }} />}
            >
              {info.pendingApproval ? (
                <>
                  Rule changes for this feature are in a{" "}
                  {info.draftRevisionStatus === "approved" ? (
                    <>
                      <strong>draft</strong> revision that has been{" "}
                      <strong>approved</strong>
                    </>
                  ) : (
                    <>
                      <strong>draft</strong> revision pending approval
                    </>
                  )}
                  .{" "}
                  {info.draftRevisionStatus === "approved"
                    ? "They"
                    : "Once approved, they"}{" "}
                  will be auto-published when this experiment starts, or you can
                  publish manually.
                  <Box mt="1">
                    <Link
                      href={`/features/${info.feature?.id}${info.draftRevisionVersion != null ? `?v=${info.draftRevisionVersion}` : ""}`}
                      target="_blank"
                    >
                      Review and approve draft
                      <PiArrowSquareOut className="ml-1" />
                    </Link>
                  </Box>
                </>
              ) : (
                <>
                  Rule changes for this feature are in a <strong>draft</strong>{" "}
                  revision. They will be auto-published when this experiment
                  starts, or you can publish manually from the{" "}
                  <Link href={`/features/${info.feature?.id}`} target="_blank">
                    Feature Flag detail page
                    <PiArrowSquareOut className="ml-1" />
                  </Link>
                  .
                </>
              )}
            </Callout>
          )}
        {info.state !== "discarded" && info.state !== "archived" && (
          <Box className="appbox" style={{ backgroundColor: "transparent" }}>
            <Flex width="100%" gap="4" py="4" px="5" direction="column">
              <Box flexGrow="1">
                <LinkedChangeVariationRows
                  alignContent={
                    info.feature.valueType === "json" ? "start" : "center"
                  }
                  experiment={experiment}
                  renderContent={(j) =>
                    !configuredVariationIds.has(variations[j].id) ? (
                      <HelperText status="warning">
                        Define missing values
                      </HelperText>
                    ) : (
                      <ForceSummary
                        value={orderedValues[j]}
                        feature={info.feature}
                        sparse={info.sparse}
                        maxHeight={60}
                      />
                    )
                  }
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
                      <strong>Notice:</strong> There are feature rules above
                      this experiment so some users might not be included.
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
    </>
  );
}
