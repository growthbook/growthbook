import { FeatureInterface } from "back-end/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { autoMerge } from "shared/util";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Modal from "../Modal";
import Button from "../Button";
import Field from "../Forms/Field";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  onDiscard?: () => void;
}

export function ExpandableDiff({
  title,
  a,
  b,
}: {
  title: string;
  a: string;
  b: string;
}) {
  const [open, setOpen] = useState(false);

  if (a === b) return null;

  return (
    <div className="diff-wrapper">
      <div
        className="list-group-item list-group-item-action d-flex"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <div className="text-muted mr-2">Changed:</div>
        <strong>{title}</strong>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>
      {open && (
        <div className="list-group-item list-group-item-light">
          <ReactDiffViewer
            oldValue={a}
            newValue={b}
            compareMethod={DiffMethod.LINES}
          />
        </div>
      )}
    </div>
  );
}

export default function DraftModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onPublish,
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
  }, [revision, baseRevision, liveRevision]);

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
  }, [mergeResult]);

  if (!revision || !mergeResult) return null;

  const hasPermission = permissions.check(
    "publishFeatures",
    feature.project,
    getAffectedRevisionEnvs(feature, revision, environments)
  );

  const hasChanges =
    !mergeResult.success ||
    Object.keys(mergeResult.result.rules || {}).length > 0 ||
    !!mergeResult.result.defaultValue;

  return (
    <Modal
      open={true}
      header={"Review Draft Changes"}
      submit={
        hasPermission
          ? async () => {
              try {
                await apiCall(
                  `/feature/${feature.id}/${revision.version}/publish`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      mergeResultSerialized: JSON.stringify(mergeResult),
                      comment,
                    }),
                  }
                );
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
              onPublish && onPublish();
            }
          : undefined
      }
      cta="Publish"
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
          <h3>Review Final Changes</h3>
          <p>
            The changes below will go live when this draft revision is
            published. You will be able to revert later if needed.
          </p>
          <div className="list-group mb-4">
            {resultDiffs.map((diff) => (
              <ExpandableDiff {...diff} key={diff.title} />
            ))}
          </div>
          {hasPermission && (
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
