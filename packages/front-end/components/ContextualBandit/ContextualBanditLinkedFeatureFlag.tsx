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
  const [editModalOpen, setEditModalOpen] = useState(false);

  const canEditCb =
    !cb.archived &&
    permissionsUtil.canUpdateContextualBandit({ project: cb.project }, {});

  const canUpdateLinkedFeature =
    canEditCb && permissionsUtil.canUpdateFeature(info.feature, {});

  const canEditFeatureDraft =
    canUpdateLinkedFeature &&
    permissionsUtil.canManageFeatureDrafts(info.feature);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await apiCall(
        `/api/v1/contextual-bandits/${cb.id}/linked-feature/${info.feature.id}`,
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

  const showEditButton =
    canEditFeatureDraft &&
    cb.status === "draft" &&
    info.state !== "discarded" &&
    info.state !== "locked" &&
    info.state !== "archived";

  const showRemoveButton =
    canUpdateLinkedFeature &&
    info.state !== "locked" &&
    info.state !== "archived";

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
        changeType={"flag"}
        heading={info.feature?.id || "Feature"}
        feature={info.feature}
        canEdit={showEditButton || showRemoveButton}
        onEdit={showEditButton ? () => setEditModalOpen(true) : undefined}
        onDelete={showRemoveButton ? handleRemove : undefined}
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
            {canUpdateLinkedFeature && (
              <>
                {" · "}
                <Link
                  onClick={handleRemove}
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
              <strong>changes beyond this contextual bandit</strong> and cannot
              be auto-published. Either remove the unrelated edits from the
              draft or publish the full draft manually.{" "}
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
              Rule changes for this feature are in a <strong>draft</strong>{" "}
              revision. They will be auto-published when this contextual bandit
              starts, or you can publish manually from the{" "}
              <Link href={`/features/${info.feature?.id}`} target="_blank">
                Feature Flag detail page
                <PiArrowSquareOut className="ml-1" />
              </Link>
              .
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
                        <VariationLabel
                          number={j}
                          name={v.name}
                          size="medium"
                        />
                      </Box>
                      <Flex flexBasis="90px" flexShrink="0" justify="end">
                        <Text>
                          {decimalToPercent(weightForIndex(j))}% Split
                        </Text>
                      </Flex>
                      <Box flexGrow="1">
                        {!configuredVariationIds.has(v.id) ? (
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
                      <strong>Notice:</strong> There are feature rules above
                      this contextual bandit so some users might not be
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
