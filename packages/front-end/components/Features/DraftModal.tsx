import { FeatureInterface } from "back-end/types/feature";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { useState, useMemo } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import {
  getAffectedEnvs,
  getEnabledEnvironments,
  useEnvironments,
} from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Modal from "../Modal";
import Button from "../Button";
import Field from "../Forms/Field";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  // eslint-disable-next-line
  mutate: () => Promise<any>;
}

function ExpandableDiff({
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

export default function DraftModal({ feature, close, mutate }: Props) {
  const environments = useEnvironments();
  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const [comment, setComment] = useState(feature.draft?.comment || "");

  const diffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if ("defaultValue" in feature.draft) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: feature.draft.defaultValue,
      });
    }
    if ("rules" in feature.draft) {
      environments.forEach((env) => {
        if (env.id in feature.draft.rules) {
          diffs.push({
            title: `Rules - ${env.id}`,
            a: JSON.stringify(
              feature.environmentSettings?.[env.id]?.rules || [],
              null,
              2
            ),
            b: JSON.stringify(feature.draft.rules[env.id] || [], null, 2),
          });
        }
      });
    }

    return diffs;
  }, [feature]);

  const hasPermission = permissions.check(
    "publishFeatures",
    feature.project,
    "defaultValue" in feature.draft
      ? getEnabledEnvironments(feature)
      : getAffectedEnvs(feature, Object.keys(feature.draft?.rules || {}))
  );

  return (
    <Modal
      open={true}
      header={"Review Draft Changes"}
      submit={
        hasPermission
          ? async () => {
              try {
                await apiCall(`/feature/${feature.id}/publish`, {
                  method: "POST",
                  body: JSON.stringify({
                    draft: feature.draft,
                    comment,
                  }),
                });
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
            }
          : null
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
                await apiCall(`/feature/${feature.id}/discard`, {
                  method: "POST",
                  body: JSON.stringify({
                    draft: feature.draft,
                  }),
                });
              } catch (e) {
                await mutate();
                throw e;
              }
              await mutate();
              close();
            }}
          >
            Discard
          </Button>
        ) : null
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
