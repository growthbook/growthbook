import React, { useState } from "react";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiGitMerge, PiXBold } from "react-icons/pi";
import LinkedChange from "@/components/Experiment/LinkedChanges/LinkedChange";
import ForceSummary from "@/components/Features/ForceSummary";
import EnvironmentStatesGrid from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { decimalToPercent } from "@/services/utils";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import EditContextualBanditFeatureValuesModal from "./EditContextualBanditFeatureValuesModal";

type Props = {
  info: LinkedFeatureInfo;
  cb: ApiContextualBanditInterface;
  mutate?: () => void;
};

export default function ContextualBanditLinkedFeatureFlag({
  info,
  cb,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [removing, setRemoving] = useState(false);
  // Value edits land on a feature draft, so nothing visible changes until it
  // publishes — track where the last save went so the card can say so.
  const [stagedValuesVersion, setStagedValuesVersion] = useState<number | null>(
    null,
  );
  const [editModalOpen, setEditModalOpen] = useState(false);

  const canEditCb =
    !cb.archived &&
    permissionsUtil.canUpdateContextualBandit({ project: cb.project }, {});

  const canUpdateLinkedFeature =
    canEditCb && permissionsUtil.canEditFeatureDrafts(info.feature);

  const canEditFeatureDraft =
    canUpdateLinkedFeature &&
    permissionsUtil.canEditFeatureDrafts(info.feature);

  // Only offered for a discarded linkage (the rule is already absent, so this
  // just clears the leftover bookkeeping — nothing publishes).
  const handleRemove = async () => {
    setRemoving(true);
    try {
      await apiCall(
        `/api/v1/contextual-bandits/${cb.id}/linked-feature/${info.feature.id}?autoPublish=true`,
        { method: "DELETE" },
      );
      mutate?.();
    } finally {
      setRemoving(false);
    }
  };

  const blockedAutoPublishIcon = (
    <Box position="relative" style={{ width: "1.2em", height: "1.2em" }}>
      <PiGitMerge
        style={{ position: "absolute", top: -2, left: 0, fontSize: "1.2em" }}
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

  const numVariations = cb.variations.length;
  const weightForIndex = (i: number): number => {
    const fallback = numVariations > 0 ? 1 / numVariations : 0;
    const variationId = cb.variations[i]?.id;
    const match = cb.variationWeights?.find(
      (w) => w.variationId === variationId,
    );
    return match?.weight ?? fallback;
  };

  const configuredVariationIds = new Set(info.values.map((v) => v.variationId));
  const orderedValues = cb.variations.map(
    (v) => info.values.find((v2) => v2.variationId === v.id)?.value || "",
  );
  // A value staged behind approval exists only on the draft — show it rather
  // than reporting the arm as unconfigured.
  const stagedValues = info.stagedDraft?.values ?? [];
  const orderedStagedValues = cb.variations.map(
    (v) => stagedValues.find((v2) => v2.variationId === v.id)?.value,
  );

  const environmentStates = Object.entries(info.environmentStates || {}).map(
    ([env, state]) => ({
      env,
      state,
      isActive: state === "active",
      tooltip:
        state === "active"
          ? "The contextual bandit is active in this environment"
          : state === "disabled-env"
            ? "The environment is disabled for this feature, so the contextual bandit is not active"
            : state === "disabled-rule"
              ? "The contextual bandit is disabled in this environment and is not active"
              : "The contextual bandit is not present in this environment",
    }),
  );

  // Values stay editable while the bandit is a draft or running — edits only
  // ever land on a Feature Flag draft, published separately.
  const showEditButton =
    canEditFeatureDraft &&
    cb.status !== "stopped" &&
    info.state !== "discarded" &&
    info.state !== "locked" &&
    info.state !== "archived";

  // Messaging for an unpublished draft revision turns on two independent axes,
  // so build the pieces here rather than nesting ternaries in the JSX:
  //   1. cb.status — auto-publish only ever fires on the start transition, so
  //      only a not-yet-started bandit can promise it. On a started bandit,
  //      info.state === "draft" means no live rule exists at all (see
  //      getRefLinkedFeatureInfo: refIsDraft is false, so the draft-differs
  //      branch is skipped and "draft" implies zero live matches).
  //   2. approval — a draft behind a required review can't be published until
  //      somebody approves it, so "publish manually" on its own isn't
  //      actionable advice.
  const cbNotStarted = cb.status === "draft";
  const awaitingApproval =
    !!info.pendingApproval && info.draftRevisionStatus !== "approved";
  const approvedNotPublished =
    !!info.pendingApproval && info.draftRevisionStatus === "approved";

  const draftRevisionHref = `/features/${info.feature?.id}${
    info.draftRevisionVersion != null ? `?v=${info.draftRevisionVersion}` : ""
  }`;

  const draftRevisionDescription = awaitingApproval ? (
    <>
      a <strong>draft</strong> revision pending approval
    </>
  ) : approvedNotPublished ? (
    <>
      a <strong>draft</strong> revision that has been <strong>approved</strong>
    </>
  ) : (
    <>
      a <strong>draft</strong> revision
    </>
  );

  const draftCalloutBody = cbNotStarted ? (
    <>
      Rule changes for this feature are in {draftRevisionDescription}.{" "}
      {awaitingApproval ? "Once approved, they" : "They"} will be auto-published
      when this contextual bandit starts, or you can publish manually.
    </>
  ) : (
    <>
      Rule changes for this feature are in {draftRevisionDescription}, so this
      contextual bandit is not serving this Feature Flag.{" "}
      {cb.status === "stopped"
        ? "This contextual bandit has stopped, so the draft will not be auto-published."
        : awaitingApproval
          ? "Drafts are only auto-published when a contextual bandit starts, so this one has to be approved and then published manually."
          : "Drafts are only auto-published when a contextual bandit starts, so this one has to be published manually."}
    </>
  );

  const draftCalloutLinkLabel = awaitingApproval
    ? "Review and approve draft"
    : cb.status === "running"
      ? "Publish draft"
      : "Review draft";

  return (
    <>
      {editModalOpen && (
        <EditContextualBanditFeatureValuesModal
          feature={info.feature}
          cb={cb}
          linkedFeatureInfo={info}
          close={() => setEditModalOpen(false)}
          mutate={() => mutate?.()}
          onSaved={(version) => setStagedValuesVersion(version)}
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
        {stagedValuesVersion != null && (
          <Callout status="info" my="4">
            Values are staged in revision #{stagedValuesVersion}. This Bandit
            keeps serving the current values until that revision is published.{" "}
            <Link
              href={`/features/${info.feature?.id}?v=${stagedValuesVersion}`}
              target="_blank"
            >
              View revision <PiArrowSquareOut className="ml-1" />
            </Link>
          </Callout>
        )}
        {info.state === "archived" && (
          <Callout status="warning" my="4">
            This Feature Flag has been archived. Unarchive it to make this
            contextual bandit active.
          </Callout>
        )}
        {info.state === "discarded" && (
          <Callout status="warning" my="4">
            The draft revision linking this contextual bandit was discarded. The
            contextual-bandit rule is no longer queued.{" "}
            <Link href={`/features/${info.feature?.id}`} target="_blank">
              Go to feature page <PiArrowSquareOut className="ml-1" />
            </Link>
            {canEditFeatureDraft && (
              <>
                {" · "}
                <Link
                  onClick={() => handleRemove()}
                  style={{ cursor: removing ? "wait" : "pointer" }}
                >
                  Remove from contextual bandit
                </Link>
              </>
            )}
          </Callout>
        )}
        {info.state === "draft" && info.hasMergeConflict && (
          <Callout status="error" my="4" icon={blockedAutoPublishIcon}>
            This feature draft has a <strong>merge conflict</strong> and cannot
            be auto-published.{" "}
            <Link href={draftRevisionHref} target="_blank">
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
              <strong>changes beyond this contextual bandit</strong> and cannot
              be auto-published. Either remove the unrelated edits from the
              draft or publish the full draft manually.{" "}
              <Link href={draftRevisionHref} target="_blank">
                Review draft
                <PiArrowSquareOut className="ml-1" />
              </Link>
            </Callout>
          )}
        {info.state === "draft" &&
          !info.hasMergeConflict &&
          !info.hasUnrelatedDraftChanges && (
            <Callout
              status={cbNotStarted ? "info" : "warning"}
              my="4"
              icon={
                cbNotStarted ? (
                  <PiGitMerge style={{ fontSize: "1.2em" }} />
                ) : (
                  blockedAutoPublishIcon
                )
              }
            >
              {draftCalloutBody}
              <Box mt="1">
                <Link href={draftRevisionHref} target="_blank">
                  {draftCalloutLinkLabel}
                  <PiArrowSquareOut className="ml-1" />
                </Link>
              </Box>
            </Callout>
          )}
        {info.state !== "discarded" && info.state !== "archived" && (
          <Box className="appbox" style={{ backgroundColor: "transparent" }}>
            <Flex width="100%" gap="4" py="4" px="5" direction="column">
              <Box flexGrow="1">
                {cb.variations.map((v, j) => (
                  <React.Fragment key={v.id}>
                    <Flex
                      align={
                        info.feature.valueType === "json" ? "start" : "center"
                      }
                      justify="between"
                      width="100%"
                      gap="9"
                      minHeight="24px"
                    >
                      <Box flexBasis="15%" flexShrink="0" minWidth="0">
                        <VariationLabel number={j} name={v.name} size="md" />
                      </Box>
                      <Flex flexBasis="90px" flexShrink="0" justify="end">
                        <Text>
                          {decimalToPercent(weightForIndex(j))}% Split
                        </Text>
                      </Flex>
                      <Box flexGrow="1">
                        {configuredVariationIds.has(v.id) ? (
                          <ForceSummary
                            value={orderedValues[j]}
                            feature={info.feature}
                            sparse={info.sparse}
                            maxHeight={60}
                          />
                        ) : orderedStagedValues[j] !== undefined ? (
                          <Flex direction="row" gap="1" align="center">
                            <ForceSummary
                              value={orderedStagedValues[j] ?? ""}
                              feature={info.feature}
                              sparse={info.sparse}
                              maxHeight={60}
                            />
                            <Callout status="warning" size="sm">
                              Staged in revision #{info.stagedDraft?.version} —
                              not serving yet
                            </Callout>
                          </Flex>
                        ) : (
                          <HelperText status="warning">
                            Define missing values
                          </HelperText>
                        )}
                      </Box>
                    </Flex>
                    {j < cb.variations.length - 1 && (
                      <Separator size="4" mt="2" mb="3" />
                    )}
                  </React.Fragment>
                ))}
              </Box>

              {(info.state === "live" || info.state === "draft") && (
                <>
                  {info.inconsistentValues && (
                    <Callout status="warning">
                      <strong>Warning:</strong> This contextual bandit is
                      included multiple times with different values. The values
                      above are from the first matching rule in{" "}
                      <strong>{info.valuesFrom}</strong>.
                    </Callout>
                  )}

                  {info.rulesAbove && (
                    <Callout status="info">
                      <strong>Notice:</strong> There are Feature Flag rules
                      above this contextual bandit so some users might not be
                      included.
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
