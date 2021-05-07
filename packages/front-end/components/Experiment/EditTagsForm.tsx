import { FC, useState } from "react";
import { useAuth } from "../../services/auth";
import { useTags } from "../../services/TagsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import TagsInput from "../TagsInput";

const EditTagsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const [tags, setTags] = useState(experiment.tags || []);
  const { apiCall } = useAuth();
  const { refreshTags } = useTags();

  return (
    <Modal
      header={"Edit Tags"}
      open={true}
      close={cancel}
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            tags,
          }),
        });
        refreshTags();
        mutate();
      }}
      cta="Save"
    >
      <label>Tags</label>
      <TagsInput
        value={tags}
        onChange={(tags) => {
          setTags(tags);
        }}
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
};

export default EditTagsForm;
