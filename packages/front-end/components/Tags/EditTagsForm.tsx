import { FC } from "react";
import { useForm } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "../Modal";
import TagsInput from "./TagsInput";

const EditTagsForm: FC<{
  tags: string[];
  save: (tags: string[]) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
}> = ({ tags = [], save, cancel, mutate }) => {
  const { refreshTags } = useDefinitions();

  const form = useForm({
    defaultValues: {
      tags,
    },
  });

  return (
    <Modal
      header={"Edit Tags"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.tags);
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
