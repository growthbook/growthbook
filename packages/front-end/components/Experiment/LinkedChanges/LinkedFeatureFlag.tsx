import { useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiArrowSquareOut, PiGitMerge, PiXBold } from "react-icons/pi";
import { isManagedByExperiment } from "shared/util";
import LinkedChange from "@/components/Experiment/LinkedChanges/LinkedChange";
import LinkedChangeVariationRows from "@/components/Experiment/LinkedChanges/LinkedChangeVariationRows";
import ForceSummary from "@/components/Features/ForceSummary";
import EnvironmentStatesGrid, {
  getEnvironmentStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditFeatureFlagValuesModal from "@/components/Experiment/LinkedChanges/EditFeatureFlagValuesModal";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Badge from "@/ui/Badge";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  onReAdd?: () => void;
  mutate?: () => void;
  /** The variation cards are already showing these values. */
  valuesShownOnVariations?: boolean;
};

export default function LinkedFeatureFlag({
  info,
  experiment,
  numLinkedChanges,
  onReAdd,
  mutate,
  valuesShownOnVariations,
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const [removing, setRemoving] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [ejectConfirm, setEjectConfirm] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const canEditExperiment =
    !experiment.archived && permissionsUtil.canUpdateExperiment(experiment, {});

  const canUpdateLinkedFeature =
    canEditExperiment && permissionsUtil.canEditFeatureDrafts(info.feature);

  // The server takes publish authority on eject; mirror it or the menu 403s.
  const canEject =
    canEditExperiment &&
    permissionsUtil.canPublishFeature(
      info.feature,
      getEnabledEnvironments(info.feature, allEnvironments),
    );

  const canEditFeatureDraft =
    canUpdateLinkedFeature &&
    permissionsUtil.canEditFeatureDrafts(info.feature);

  // Gates the "Re-add feature flag" link in the discarded callout: requires
  // feature-draft perms AND the experiment to still be in draft status with no
  // scheduled launch (post-launch, re-adding the rule isn't allowed).
  const canAddLinkedChanges =
    canEditFeatureDraft &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate;

  const handleRemove = async () => {
    if (!confirm("Remove this Feature Flag from the experiment?")) return;
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

  const isManaged = isManagedByExperiment(info.feature, experiment.id);

  const handleEject = async () => {
    setEjecting(true);
    try {
      await apiCall(`/experiment/${experiment.id}/managed-flag/eject`, {
        method: "POST",
      });
      setEjectConfirm(false);
      mutate?.();
    } finally {
      setEjecting(false);
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

  const environmentStates = getEnvironmentStates(info, {
    future: experiment.status === "draft" ? "started" : false,
  });

  // With values on the variation cards, this only earns space for a warning.
  const hasValueWarnings =
    (info.state === "live" || info.state === "draft") &&
    (info.inconsistentValues || info.rulesAbove);
  // A managed flag renders no value rows, so it would otherwise be empty.
  const showValueSection = isManaged
    ? hasValueWarnings
    : !valuesShownOnVariations || hasValueWarnings;

  const showEditButton =
    canEditFeatureDraft &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    info.state !== "discarded" &&
    info.state !== "locked" &&
    info.state !== "archived";

  return (
    <>
      {ejectConfirm && (
        <ConfirmDialog
          title="Convert to unmanaged Feature Flag?"
          content="This experiment keeps using the linked Feature Flag, but you'll manage and review it directly from its own page instead of from here."
          yesText="Convert"
          onConfirm={handleEject}
          onCancel={() => setEjectConfirm(false)}
        />
      )}
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
        managedBadge={
          isManaged ? (
            <Badge label="Managed by experiment" radius="full" color="violet" />
          ) : undefined
        }
        actions={
          isManaged ? (
            // Set even when empty, or the default cluster offers Edit/Remove.
            <>
              {canEject && (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="2"
                      highContrast
                    >
                      <BsThreeDotsVertical size={16} />
                    </IconButton>
                  }
                  menuPlacement="end"
                >
                  <DropdownMenuItem
                    disabled={ejecting}
                    onClick={() => setEjectConfirm(true)}
                  >
                    Convert to unmanaged Feature Flag
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
            </>
          ) : undefined
        }
        additionalBadge={(() => {
          if (info.state === "archived") {
            return <Badge label="Archived" radius="full" color="gray" />;
          }
          // Review status: live/draft is implied, and would fight the CTA.
          const revisionStatus =
            isManaged && info.pendingDraft
              ? info.pendingDraft.status
              : info.state === "live"
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
            This Feature Flag has been archived. Unarchive it to make this
            experiment active.
          </Callout>
        )}
        {info.state === "discarded" && (
          <Callout status="warning" my="4">
            The draft revision linking this experiment was discarded. The
            experiment-ref rule is no longer queued.{" "}
            {canAddLinkedChanges && onReAdd ? (
              <Link onClick={onReAdd} style={{ cursor: "pointer" }}>
                Re-add Feature Flag
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
        {/* A managed flag says this once, page-level, above the fold. */}
        {!isManaged &&
          info.state === "draft" &&
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
            {showValueSection && (
              <Flex width="100%" gap="4" py="4" px="5" direction="column">
                {!isManaged && (
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
                )}

                {(info.state === "live" || info.state === "draft") && (
                  <>
                    {info.inconsistentValues && (
                      <Callout status="warning">
                        <strong>Warning:</strong> This experiment is included
                        multiple times with different values. The values above
                        are from the first matching experiment in{" "}
                        <strong>{info.valuesFrom}</strong>.
                      </Callout>
                    )}

                    {info.rulesAbove && (
                      <Callout status="info">
                        <strong>Notice:</strong> There are Feature Flag rules
                        above this experiment so some users might not be
                        included.
                      </Callout>
                    )}
                  </>
                )}
              </Flex>
            )}

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
