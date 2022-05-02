import { FeatureDraftChanges, FeatureInterface } from "back-end/types/feature";
import { useEnvironments } from "../../services/features";
import Modal from "../Modal";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Button from "../Button";
import { useAuth } from "../../services/auth";

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
      header={"Review Feature Changes"}
      submit={async () => {
        await apiCall(`/feature/${feature.id}/publish`, {
          method: "POST",
        });
        await mutate();
      }}
      cta="Publish Changes"
      close={close}
      size="lg"
      secondaryCTA={
        <Button
          color="outline-danger"
          onClick={async () => {
            await apiCall(`/feature/${feature.id}/discard`, {
              method: "POST",
            });
            await mutate();
            close();
          }}
        >
          Discard Changes
        </Button>
      }
    >
      <h3>Unpublished Changes</h3>
      <ReactDiffViewer
        oldValue={JSON.stringify(orig, null, 2)}
        newValue={JSON.stringify(changes, null, 2)}
        compareMethod={DiffMethod.LINES}
      />
    </Modal>
  );
}
