import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { filterEnvironmentsByFeature, getReviewSetting } from "shared/util";
import { Flex, Box } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import {
  PiCaretRightBold,
  PiShieldCheckBold,
  PiWarningBold,
} from "react-icons/pi";
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
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import useOrgSettings from "@/hooks/useOrgSettings";
import { ExpandableDiff } from "./DraftModal";

export type RevertStrategy = "draft" | "publish";

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

  // Previously-published revisions the user can revert to, newest-published
  // first. Computed before targetVersion state so the initial value can use
  // publishedRevisions[0] (most recently published before live).
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

  const [targetVersion, setTargetVersion] = useState(
    () => publishedRevisions[0]?.version ?? revision.version,
  );
  const [comment, setComment] = useState(`Revert from #${feature.version}`);
  const [strategy, setStrategy] = useState<RevertStrategy>("draft");

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

  const canUsePublishStrategy = approvalsRequired
    ? canBypassApprovals
    : canPublish;

  const strategyOptions = [
    {
      value: "draft" as RevertStrategy,
      label: "Create a revert draft",
      description:
        "Computes the diff and creates a new draft based on the current live revision." +
        (approvalsRequired ? " Subject to approval requirements." : ""),
      disabled: !canCreateDraft,
    },
    {
      value: "publish" as RevertStrategy,
      label: (
        <span>
          Set a prior revision live{" "}
          {approvalsRequired && (
            <span style={{ color: "var(--red-11)" }}>(admin only)</span>
          )}
        </span>
      ),
      description:
        "Immediately makes the selected revision the live version" +
        (approvalsRequired ? ", bypassing any approval requirements." : "."),
      disabled: !canUsePublishStrategy,
      error: !canUsePublishStrategy
        ? approvalsRequired
          ? "You do not have permission to bypass approvals"
          : "You do not have permission to publish this feature"
        : undefined,
    },
  ];

  const canSubmit =
    strategy === "draft" ? canCreateDraft : canUsePublishStrategy;

  const ctaLabel =
    strategy === "draft" ? "Create Revert Draft" : "Set Revision Live";

  const triggerLabel =
    strategy === "draft" ? (
      <>
        will be added to <Text weight="semibold">a new draft</Text>
      </>
    ) : (
      <Text weight="semibold">published immediately</Text>
    );

  const triggerIcon =
    strategy === "publish" ? (
      <PiWarningBold size={16} />
    ) : (
      <PiShieldCheckBold size={16} />
    );

  const strategyTrigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      px="3"
      py="4"
      style={{ cursor: "pointer", userSelect: "none" }}
      className="draft-selector-collapsible-trigger"
    >
      <HelperText
        status={strategy === "publish" ? "warning" : "info"}
        icon={triggerIcon}
      >
        <div className="ml-1">Revert {triggerLabel}</div>
      </HelperText>
      <PiCaretRightBold className="chevron-right" style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header="Revert"
      submit={
        canSubmit
          ? async () => {
              if (strategy === "draft") {
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
      cta={ctaLabel}
      close={close}
      closeCta="Cancel"
      size="lg"
    >
      <Box
        mb="5"
        style={{ overflow: "hidden", borderRadius: "var(--radius-4)" }}
      >
        <Collapsible
          trigger={strategyTrigger}
          transitionTime={75}
          contentInnerClassName="draft-selector-collapsible-content"
        >
          <Box px="3" py="3" style={{ backgroundColor: "var(--violet-a3)" }}>
            <RadioGroup
              options={strategyOptions}
              value={strategy}
              setValue={(v) => setStrategy(v as RevertStrategy)}
              width="100%"
            />
            {strategy === "publish" && !canUsePublishStrategy && (
              <Callout status="error" mt="2">
                {approvalsRequired
                  ? "You need admin permissions to bypass approvals and publish immediately."
                  : "You do not have permission to publish this feature."}
              </Callout>
            )}
          </Box>
        </Collapsible>
      </Box>

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
