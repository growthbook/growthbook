import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { autoMerge, mergeResultHasChanges } from "shared/util";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Modal from "../Modal";
import Button from "../Button";
import Field from "../Forms/Field";
import { ExpandableDiff } from "./DraftModal";

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

  const revision = revisions.find((r) => r.version === version);
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
      submit={() => false}
      autoCloseOnSubmit={false}
      cta="Next"
      ctaEnabled={!!mergeResult.success && hasChanges}
      close={close}
      closeCta="Cancel"
      size="max"
      secondaryCTA={
        permissions.check("createFeatureDrafts", feature.project) ? (
          <Button
            color="outline-danger"
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
          </Button>
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
          <h4>Publishing to the prod environment requires approval.</h4>
          <p>
            The changes below will go live when this draft revision is
            published. You will be able to revert later if needed.
          </p>
          <div className="list-group mb-4">
            {resultDiffs.map((diff) => (
              <ExpandableDiff {...diff} key={diff.title} />
            ))}
          </div>
          {hasPermission ? (
            <Field
              label="Add a Comment (optional)"
              textarea
              placeholder="Summary of changes..."
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
            />
          ) : (
            <div className="alert alert-info">
              You do not have permission to publish this draft.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
