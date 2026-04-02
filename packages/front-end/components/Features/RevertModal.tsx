import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo } from "react";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { Flex, Box } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import Text from "@/ui/Text";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { ExpandableDiff } from "./DraftModal";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  /** Minimal list for the dropdown — up to 200 entries. */
  revisionList: MinimalFeatureRevisionInterface[];
  /** Full revisions for diff preview — lazily cached. */
  allRevisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function RevertModal({
  feature,
  revision,
  revisionList,
  allRevisions,
  close,
  mutate,
  setVersion,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();

  // Previously-published revisions the user can revert to, newest-published first.
  // Uses the full revisionList (up to 200) so older publishes aren't cut off by
  // the top-5 full-content cache.
  const publishedRevisions = useMemo(
    () =>
      revisionList
        .filter(
          (r) => r.status === "published" && r.version !== feature.version,
        )
        .sort((a, b) => {
          const bt = b.datePublished ? new Date(b.datePublished).getTime() : 0;
          const at = a.datePublished ? new Date(a.datePublished).getTime() : 0;
          return bt - at;
        }),
    [revisionList, feature.version],
  );

  const settings = useOrgSettings();
  const approvalsRequired = useMemo(() => {
    const raw = settings?.requireReviews;
    if (!raw) return false;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  }, [settings?.requireReviews, feature]);

  const [targetVersion, setTargetVersion] = useState(() => {
    const inList = publishedRevisions.some(
      (r) => r.version === revision.version,
    );
    return inList
      ? revision.version
      : (publishedRevisions[0]?.version ?? revision.version);
  });
  const [comment, setComment] = useState(`Revert from #${feature.version}`);
  const [mode, setMode] = useState<DraftMode>(() =>
    approvalsRequired ? "new" : "publish",
  );

  const targetRevisionFromCache = allRevisions.find(
    (r) => r.version === targetVersion,
  );
  // If the selected version isn't in the parent's lazy cache, fetch it directly.
  const { data: fetchedRevisionData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${feature.id}/revisions?versions=${targetVersion}`, {
    shouldRun: () => !targetRevisionFromCache,
  });
  const targetRevision =
    targetRevisionFromCache ??
    fetchedRevisionData?.revisions?.find((r) => r.version === targetVersion);
  const isLoadingRevision = !targetRevision;
  // Fall back to current revision only for submit/permissions — never for the diff.
  const targetRevisionForAction = targetRevision ?? revision;

  const diffs = useFeatureRevisionDiff({
    current: featureToFeatureRevisionDiffInput(feature),
    draft: targetRevisionForAction,
  });

  const affectedEnvs = getAffectedRevisionEnvs(
    feature,
    targetRevisionForAction,
    environments,
  );

  const canPublish = permissionsUtil.canPublishFeature(feature, affectedEnvs);
  const canBypassApprovals = permissionsUtil.canBypassApprovalChecks(feature);
  const canCreateDraft =
    permissionsUtil.canUpdateFeature(feature, {}) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  const canAutoPublish = approvalsRequired ? canBypassApprovals : canPublish;
  const gatedEnvSet: "all" | "none" = approvalsRequired ? "all" : "none";

  const canSubmit = mode === "new" ? canCreateDraft : canAutoPublish;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header="Revert"
      submit={
        canSubmit && !isLoadingRevision
          ? async () => {
              if (mode === "new") {
                const res = await apiCall<{ version: number }>(
                  `/feature/${feature.id}/${targetRevisionForAction.version}/revert-draft`,
                  {
                    method: "POST",
                    body: JSON.stringify({ comment }),
                  },
                );
                await mutate();
                if (res?.version) setVersion(res.version);
              } else {
                const res = await apiCall<{ version: number }>(
                  `/feature/${feature.id}/${targetRevisionForAction.version}/revert`,
                  {
                    method: "POST",
                    body: JSON.stringify({ comment }),
                  },
                );
                await mutate();
                if (res?.version) setVersion(res.version);
              }
            }
          : undefined
      }
      cta={mode === "publish" ? "Publish Now" : "Create Revert Draft"}
      close={close}
      closeCta="Cancel"
      size="lg"
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={allRevisions}
        mode={mode}
        setMode={setMode}
        selectedDraft={null}
        setSelectedDraft={() => undefined}
        canAutoPublish={canAutoPublish}
        gatedEnvSet={gatedEnvSet}
        hideExisting={true}
        triggerPrefix="Revert will be"
        defaultExpanded
      />

      <h3>Review Changes</h3>
      <Flex align="center" gap="2" mb="3" wrap="wrap">
        <Text weight="medium">Reverting to:</Text>
        <Box style={{ flex: 1, minWidth: 200, maxWidth: 480 }}>
          <RevisionDropdown
            feature={feature}
            revisions={publishedRevisions}
            version={targetVersion}
            setVersion={setTargetVersion}
            publishedOnly={true}
            menuPlacement="start"
          />
        </Box>
      </Flex>
      <div className="list-group mb-4">
        {isLoadingRevision ? (
          <div className="text-muted">Loading revision…</div>
        ) : (
          diffs
            .filter((d) => d.a !== d.b)
            .map((diff) => <ExpandableDiff {...diff} key={diff.title} />)
        )}
      </div>

      <Field
        label="Add a Comment (optional)"
        textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
      />
    </Modal>
  );
}
