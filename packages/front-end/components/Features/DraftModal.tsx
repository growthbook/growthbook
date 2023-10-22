import { FeatureInterface } from "back-end/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import isEqual from "lodash/isEqual";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Modal from "../Modal";
import Button from "../Button";
import Field from "../Forms/Field";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
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
  revision,
  close,
  mutate,
  onPublish,
  onDiscard,
}: Props) {
  const environments = useEnvironments();
  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const [comment, setComment] = useState(revision.comment || "");

  const diffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if (revision.defaultValue !== feature.defaultValue) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: revision.defaultValue,
      });
    }
    environments.forEach((env) => {
      const liveRules = feature.environmentSettings?.[env.id]?.rules || [];
      const draftRules = revision.rules?.[env.id] || [];

      if (!isEqual(liveRules, draftRules)) {
        diffs.push({
          title: `Rules - ${env.id}`,
          a: JSON.stringify(liveRules, null, 2),
          b: JSON.stringify(draftRules, null, 2),
        });
      }
    });

    return diffs;
  }, [feature]);

  const hasPermission = permissions.check(
    "publishFeatures",
    feature.project,
    getAffectedRevisionEnvs(feature, revision)
  );

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
      close={close}
      closeCta="close"
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
      <h3>Review Changes</h3>
      <p>
        The changes below will go live when this draft version is published. You
        will be able to revert later if needed.
      </p>
      <div className="list-group mb-4">
        {diffs.map((diff) => (
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
    </Modal>
  );
}
