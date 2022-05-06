import { FeatureDraftChanges, FeatureInterface } from "back-end/types/feature";
import { useEnvironments } from "../../services/features";
import Modal from "../Modal";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Button from "../Button";
import { useAuth } from "../../services/auth";
import { useState } from "react";
import Field from "../Forms/Field";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  // eslint-disable-next-line
  mutate: () => Promise<any>;
}

export default function DraftModal({ feature, close, mutate }: Props) {
  const environments = useEnvironments();

  const { apiCall } = useAuth();

  const orig: Partial<FeatureDraftChanges> = {};
  const changes: Partial<FeatureDraftChanges> = {};

  const [comment, setComment] = useState(feature.draft?.comment || "");

  if ("defaultValue" in feature.draft) {
    orig.defaultValue = feature.defaultValue;
    changes.defaultValue = feature.draft.defaultValue;
  }
  if ("rules" in feature.draft) {
    orig.rules = orig.rules || {};
    changes.rules = changes.rules || {};
    environments.forEach((env) => {
      if (env.id in feature.draft.rules) {
        orig.rules[env.id] = feature.environmentSettings?.[env.id]?.rules || [];
        changes.rules[env.id] = feature.draft.rules[env.id];
      }
    });
  }

  return (
    <Modal
      open={true}
      header={"Publish Revision"}
      submit={async () => {
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
      }}
      cta="Publish"
      close={close}
      closeCta="close"
      size="lg"
      secondaryCTA={
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
      }
    >
      <h3>Changes</h3>
      <div style={{ maxHeight: "50vw", overflowY: "auto" }} className="mb-3">
        <ReactDiffViewer
          oldValue={JSON.stringify(orig, null, 2)}
          newValue={JSON.stringify(changes, null, 2)}
          compareMethod={DiffMethod.LINES}
        />
      </div>
      <Field
        label="Comment (optional)"
        textarea
        placeholder="Summary of changes..."
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
      />
    </Modal>
  );
}
