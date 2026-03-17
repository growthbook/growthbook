import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { Flex, Box } from "@radix-ui/themes";
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
  /** Full list of all revisions — used to populate the target-version picker. */
  allRevisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function RevertModal({
  feature,
  revision,
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
  const publishedRevisions = useMemo(
    () =>
      allRevisions
        .filter(
          (r) => r.status === "published" && r.version !== feature.version,
        )
        .sort((a, b) => {
          const bt = b.datePublished ? new Date(b.datePublished).getTime() : 0;
          const at = a.datePublished ? new Date(a.datePublished).getTime() : 0;
          return bt - at;
        }),
    [allRevisions, feature.version],
  );

  const [targetVersion, setTargetVersion] = useState(() => {
    const inList = publishedRevisions.some(
      (r) => r.version === revision.version,
    );
    return inList
      ? revision.version
      : (publishedRevisions[0]?.version ?? revision.version);
  });
  const [comment, setComment] = useState(`Revert from #${feature.version}`);
  const [mode, setMode] = useState<DraftMode>("new");

  const targetRevision =
    allRevisions.find((r) => r.version === targetVersion) ?? revision;

  const diffs = useFeatureRevisionDiff({
    current: featureToFeatureRevisionDiffInput(feature),
    draft: targetRevision,
  });

  const affectedEnvs = getAffectedRevisionEnvs(
    feature,
    targetRevision,
    environments,
  );

  const canPublish = permissionsUtil.canPublishFeature(feature, affectedEnvs);
  const canBypassApprovals = permissionsUtil.canBypassApprovalChecks(feature);
  const canCreateDraft =
    permissionsUtil.canUpdateFeature(feature, {}) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  const settings = useOrgSettings();
  const approvalsRequired = useMemo(() => {
    const raw = settings?.requireReviews;
    if (!raw) return false;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  }, [settings?.requireReviews, feature]);

  const canAutoPublish = approvalsRequired ? canBypassApprovals : canPublish;
  const gatedEnvSet: "all" | "none" = approvalsRequired ? "all" : "none";

  const canSubmit = mode === "new" ? canCreateDraft : canAutoPublish;

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header="Revert"
      submit={
        canSubmit
          ? async () => {
              if (mode === "new") {
                const res = await apiCall<{ version: number }>(
                  `/feature/${feature.id}/${targetRevision.version}/revert-draft`,
                  {
                    method: "POST",
                    body: JSON.stringify({ comment }),
                  },
                );
                await mutate();
                if (res?.version) setVersion(res.version);
              } else {
                const res = await apiCall<{ version: number }>(
                  `/feature/${feature.id}/${targetRevision.version}/revert`,
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
            variant="select"
            publishedOnly={true}
            menuPlacement="start"
          />
        </Box>
      </Flex>
      <div className="list-group mb-4">
        {diffs
          .filter((d) => d.a !== d.b)
          .map((diff) => (
            <ExpandableDiff {...diff} key={diff.title} />
          ))}
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
