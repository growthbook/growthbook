import { contextualBanditEndpoints } from "shared/api-endpoints";
import React, { useState } from "react";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import { linkedDraftApproved } from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiGitMerge, PiXBold } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRestApiCall } from "@/services/restApi";
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
  const { t, i18n } = useLingui();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const [removing, setRemoving] = useState(false);
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
      await restApiCall(
        contextualBanditEndpoints.deleteContextualBanditLinkedFeature,
        {
          params: { id: cb.id, featureId: info.feature.id },
          query: { autoPublish: true },
        },
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

  const stagedDrafts = info.stagedDrafts ?? [];
  const variationValueStates = cb.variations.map((v) => {
    const liveValue = info.values.find((v2) => v2.variationId === v.id)?.value;
    const staged = stagedDrafts
      .map((d) => ({
        version: d.version,
        value: d.values.find((v2) => v2.variationId === v.id)?.value,
      }))
      .find((s) => s.value !== undefined && s.value !== liveValue);
    return {
      liveValue,
      stagedValue: staged?.value,
      stagedVersion: staged?.version,
      hasLiveValue: liveValue !== undefined,
      hasStagedChange: staged !== undefined,
    };
  });

  const stagedVersions = variationValueStates.flatMap((s) =>
    s.stagedVersion != null ? [s.stagedVersion] : [],
  );
  const stagedChangeVersion = stagedVersions.length
    ? Math.max(...stagedVersions)
    : undefined;

  const environmentStates = Object.entries(info.environmentStates || {}).map(
    ([env, state]) => ({
      env,
      state,
      isActive: state === "active",
      tooltip:
        state === "active"
          ? t`The contextual bandit is active in this environment`
          : state === "disabled-env"
            ? t`The environment is disabled for this feature, so the contextual bandit is not active`
            : state === "disabled-rule"
              ? t`The contextual bandit is disabled in this environment and is not active`
              : t`The contextual bandit is not present in this environment`,
    }),
  );

  // Values stay editable while the bandit is a draft or running — edits only
  // ever land on a Feature Flag draft, published separately.
  const showEditButton =
    canEditFeatureDraft &&
    cb.status !== "stopped" &&
    info.state !== "discarded" &&
    info.state !== "archived";

  const cbNotStarted = cb.status === "draft";
  const awaitingApproval = !!info.pendingApproval && !linkedDraftApproved(info);
  const approvedNotPublished =
    !!info.pendingApproval && linkedDraftApproved(info);

  const draftRevisionHref = `/features/${info.feature?.id}${
    info.draftRevisionVersion != null ? `?v=${info.draftRevisionVersion}` : ""
  }`;

  const draftRevisionSentence = cbNotStarted ? (
    awaitingApproval ? (
      <Trans>
        Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
        revision pending approval.
      </Trans>
    ) : approvedNotPublished ? (
      <Trans>
        Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
        revision that has been <strong>approved</strong>.
      </Trans>
    ) : (
      <Trans>
        Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
        revision.
      </Trans>
    )
  ) : awaitingApproval ? (
    <Trans>
      Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
      revision pending approval, so this Contextual Bandit is not serving this
      Feature Flag.
    </Trans>
  ) : approvedNotPublished ? (
    <Trans>
      Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
      revision that has been <strong>approved</strong>, so this Contextual
      Bandit is not serving this Feature Flag.
    </Trans>
  ) : (
    <Trans>
      Rule changes for this Feature Flag are in a <strong>draft</strong>{" "}
      revision, so this Contextual Bandit is not serving this Feature Flag.
    </Trans>
  );

  const draftCalloutBody = (
    <>
      {draftRevisionSentence}{" "}
      {cbNotStarted
        ? awaitingApproval
          ? t`Once approved, they will be auto-published when this Contextual Bandit starts, or you can publish manually.`
          : t`They will be auto-published when this Contextual Bandit starts, or you can publish manually.`
        : cb.status === "stopped"
          ? t`This Contextual Bandit has stopped, so the draft will not be auto-published.`
          : awaitingApproval
            ? t`Drafts are only auto-published when a Contextual Bandit starts, so this one has to be approved and then published manually.`
            : t`Drafts are only auto-published when a Contextual Bandit starts, so this one has to be published manually.`}
    </>
  );

  const draftCalloutLinkLabel = awaitingApproval
    ? t`Review and approve draft`
    : cb.status === "running"
      ? t`Publish draft`
      : t`Review draft`;

  const valuesFrom = info.valuesFrom;

  return (
    <>
      {editModalOpen && (
        <EditContextualBanditFeatureValuesModal
          feature={info.feature}
          cb={cb}
          linkedFeatureInfo={info}
          close={() => setEditModalOpen(false)}
          mutate={() => mutate?.()}
        />
      )}
      <LinkedChange
        heading={info.feature?.id || t`Feature`}
        feature={info.feature}
        canEdit={showEditButton}
        onEdit={showEditButton ? () => setEditModalOpen(true) : undefined}
        additionalBadge={(() => {
          if (info.state === "archived") {
            return <Badge label={t`Archived`} radius="full" color="gray" />;
          }
          const revisionStatus =
            info.state === "live"
              ? "live"
              : info.state === "draft"
                ? "draft"
                : info.state === "discarded"
                  ? "discarded"
                  : null;
          if (!revisionStatus) return null;
          return (
            <Badge
              label={revisionStatusLabel(revisionStatus, i18n)}
              radius="full"
              color={revisionStatusColor(revisionStatus)}
            />
          );
        })()}
      >
        {stagedChangeVersion != null && (
          <Callout status="info" my="4">
            <Trans>
              There is a new revision with changes to variation values. The
              values below are live until the changes are published.
            </Trans>
            <Box mt="1">
              <Link
                href={`/features/${info.feature?.id}?v=${stagedChangeVersion}`}
                target="_blank"
              >
                <Trans>Review draft</Trans>
                <PiArrowSquareOut className="ml-1" />
              </Link>
            </Box>
          </Callout>
        )}
        {info.state === "archived" && (
          <Callout status="warning" my="4">
            <Trans>
              This Feature Flag has been archived. Unarchive it to make this
              contextual bandit active.
            </Trans>
          </Callout>
        )}
        {info.state === "discarded" && (
          <Callout status="warning" my="4">
            <Trans>
              The draft revision linking this contextual bandit was discarded.
              The contextual-bandit rule is no longer queued.
            </Trans>{" "}
            <Link href={`/features/${info.feature?.id}`} target="_blank">
              <Trans>Go to feature page</Trans>{" "}
              <PiArrowSquareOut className="ml-1" />
            </Link>
            {canEditFeatureDraft && (
              <>
                {" · "}
                <Link
                  onClick={() => handleRemove()}
                  style={{ cursor: removing ? "wait" : "pointer" }}
                >
                  <Trans>Remove from contextual bandit</Trans>
                </Link>
              </>
            )}
          </Callout>
        )}
        {info.state === "draft" && info.hasMergeConflict && (
          <Callout status="error" my="4" icon={blockedAutoPublishIcon}>
            <Trans>
              This feature draft has a <strong>merge conflict</strong> and
              cannot be auto-published.
            </Trans>{" "}
            <Link href={draftRevisionHref} target="_blank">
              <Trans>Fix conflicts</Trans>
              <PiArrowSquareOut className="ml-1" />
            </Link>
          </Callout>
        )}
        {info.state === "draft" &&
          !info.hasMergeConflict &&
          info.hasUnrelatedDraftChanges && (
            <Callout status="error" my="4" icon={blockedAutoPublishIcon}>
              <Trans>
                This feature draft contains{" "}
                <strong>changes beyond this contextual bandit</strong> and
                cannot be auto-published. Either remove the unrelated edits from
                the draft or publish the full draft manually.
              </Trans>{" "}
              <Link href={draftRevisionHref} target="_blank">
                <Trans>Review draft</Trans>
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
                {cb.variations.map((v, j) => {
                  const splitPercent = decimalToPercent(weightForIndex(j));
                  const stagedVersion = variationValueStates[j].stagedVersion;
                  return (
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
                            <Trans>{splitPercent}% Split</Trans>
                          </Text>
                        </Flex>
                        <Box flexGrow="1">
                          {!variationValueStates[j].hasLiveValue &&
                          !variationValueStates[j].hasStagedChange ? (
                            <HelperText status="warning">
                              <Trans>Define missing values</Trans>
                            </HelperText>
                          ) : (
                            <Flex direction="column" gap="1">
                              {variationValueStates[j].hasLiveValue && (
                                <ForceSummary
                                  value={
                                    variationValueStates[j].liveValue ?? ""
                                  }
                                  feature={info.feature}
                                  sparse={info.sparse}
                                  maxHeight={60}
                                />
                              )}
                              {variationValueStates[j].hasStagedChange && (
                                <HelperText status="warning">
                                  <Trans>
                                    Staged in revision #{stagedVersion} — not
                                    serving yet
                                  </Trans>
                                </HelperText>
                              )}
                            </Flex>
                          )}
                        </Box>
                      </Flex>
                      {j < cb.variations.length - 1 && (
                        <Separator size="4" mt="2" mb="3" />
                      )}
                    </React.Fragment>
                  );
                })}
              </Box>

              {(info.state === "live" || info.state === "draft") && (
                <>
                  {info.inconsistentValues && (
                    <Callout status="warning">
                      <Trans>
                        <strong>Warning:</strong> This contextual bandit is
                        included multiple times with different values. The
                        values above are from the first matching rule in{" "}
                        <strong>{valuesFrom}</strong>.
                      </Trans>
                    </Callout>
                  )}

                  {info.rulesAbove && (
                    <Callout status="info">
                      <Trans>
                        <strong>Notice:</strong> There are Feature Flag rules
                        above this contextual bandit so some users might not be
                        included.
                      </Trans>
                    </Callout>
                  )}
                </>
              )}
            </Flex>

            <Separator size="4" />
            <EnvironmentStatesGrid environmentStates={environmentStates} />
          </Box>
        )}
      </LinkedChange>
    </>
  );
}
