import { FC } from "react";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import TagsInput from "../TagsInput";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "back-end/types/feature";

const EditTagsForm: FC<{
  experiment?: ExperimentInterfaceStringDates;
  feature?: FeatureInterface;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment = null, feature = null, cancel, mutate }) => {
  const { apiCall } = useAuth();
  const { refreshTags } = useDefinitions();

  const form = useForm({
    defaultValues: {
      tags: experiment?.tags || feature?.tags || [],
    },
  });

  return (
    <Modal
      header={"Edit Tags"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        if (experiment) {
          await apiCall(`/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify(data),
          });
        } else if (feature) {
          await apiCall(`/feature/${feature.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
        }
        refreshTags(data.tags);
        mutate();
      })}
      cta="Save"
    >
      <label>Tags</label>
      <TagsInput
        value={form.watch("tags")}
        onChange={(tags) => form.setValue("tags", tags)}
      />
      <div style={{ height: 200 }} />
    </Modal>
  );
};

export default EditTagsForm;
