import { FC } from "react";
import { ApiContextualBanditInterface } from "shared/validators";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";

const ContextualBanditVisualChangesetModal: FC<{
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
  onCreate?: (vc: VisualChangesetInterface) => void;
  source?: string;
}> = ({ cb, mutate, close, onCreate, source }) => {
  return (
    <VisualChangesetModal
      mode="add"
      createUrl={`/api/v1/contextual-bandits/${cb.id}/visual-changesets`}
      mutate={mutate}
      close={close}
      onCreate={onCreate}
      source={source}
    />
  );
};

export default ContextualBanditVisualChangesetModal;
