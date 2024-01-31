import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { autoMerge, mergeResultHasChanges } from "shared/util";
import { Callout } from "@radix-ui/themes";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import LegacyButton from "../Button";
import { ExpandableDiff } from "./DraftModal";
import Revisionlog from "./RevisionLog";
export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  onDiscard?: () => void;
}

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onDiscard,
}: Props) {
  const environments = useEnvironments();
  const permissions = usePermissions();

  const { apiCall } = useAuth();
  const user = useUser();
  const revision = revisions.find((r) => r.version === version);
  const isPendingReview = revision?.status === "pending-review";
  const canReview = isPendingReview && revision?.createdBy?.id !== user.userId;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [revision, baseRevision, liveRevision, environments]);

  const [comment, setComment] = useState(revision?.comment || "");

  const submitButton = async () => {
    if (!isPendingReview) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/request`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
    } else if (canReview) {
      return;
    }
  };

  const resultDiffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if (!mergeResult) return diffs;
    if (!mergeResult.success) return diffs;

    const result = mergeResult.result;

    if (result.defaultValue !== undefined) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: result.defaultValue,
      });
    }
    if (result.rules) {
      environments.forEach((env) => {
        const liveRules = feature.environmentSettings?.[env.id]?.rules || [];
        if (result.rules && result.rules[env.id]) {
          diffs.push({
            title: `Rules - ${env.id}`,
            a: JSON.stringify(liveRules, null, 2),
            b: JSON.stringify(result.rules[env.id], null, 2),
          });
        }
      });
    }

    return diffs;
  }, [
    environments,
    feature.defaultValue,
    feature.environmentSettings,
    mergeResult,
  ]);

  if (!revision || !mergeResult) return null;

  const hasPermission = permissions.check(
    "publishFeatures",
    feature.project,
    getAffectedRevisionEnvs(feature, revision, environments)
  );

  const hasChanges = mergeResultHasChanges(mergeResult);
  return (
    <Modal
      open={true}
      header={"Review Draft Changes"}
      cta={canReview ? "Next" : "Request Review"}
      close={close}
      closeCta="Cancel"
      size="max"
      submit={!isPendingReview || canReview ? submitButton : undefined}
      secondaryCTA={
        isPendingReview && !canReview ? (
          <LegacyButton
            color="danger"
            onClick={async () => {
              try {
                await apiCall(
                  `/feature/${feature.id}/${revision.version}/discard`,
                  {
                    method: "POST",
                  }
                );
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
              onDiscard && onDiscard();
              close();
            }}
          >
            Discard
          </LegacyButton>
        ) : undefined
      }
    >
      {mergeResult.conflicts.length > 0 && (
        <div className="alert alert-danger">
          <strong>Conflicts Detected</strong>. Please fix conflicts before
          publishing this draft.
        </div>
      )}

      {!hasChanges && !mergeResult.conflicts.length && (
        <div className="alert alert-info">
          There are no changes to publish. Either discard the draft or add
          changes first before publishing.
        </div>
      )}

      {mergeResult.success && hasChanges && (
        <div>
          <Callout.Root color={isPendingReview ? "amber" : "gray"}>
            <Callout.Text>
              Publishing to the prod environment requires approval.
            </Callout.Text>
          </Callout.Root>

          <div className="list-group mb-4 mt-4">
            {resultDiffs.map((diff) => (
              <ExpandableDiff {...diff} key={diff.title} />
            ))}
          </div>
          <Revisionlog
            feature={feature}
            revision={revision}
            commentsOnly={true}
          />
          {hasPermission && !isPendingReview && (
            <Field
              label="Add a Comment (optional)"
              textarea
              placeholder="Summary of changes..."
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
