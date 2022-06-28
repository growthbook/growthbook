import { FC } from "react";
// import Modal from "../Modal";
// import { useForm } from "react-hook-form";
// import TagsInput from "../Tags/TagsInput";
import { UserRef } from "back-end/types/user";
// import { getOwnerByUserRef } from "../../services/utils";
// import MultiSelectField from "../Forms/MultiSelectField";

const EditTagsForm: FC<{
  owner: UserRef | undefined;
  save: (ownerName: string | undefined) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
}> = ({ owner, save, cancel, mutate }) => {
  console.log(owner);
  console.log(save);
  console.log(cancel);
  console.log(mutate);

  // const form = useForm({
  //   defaultValues: {
  //     owner: getOwnerByUserRef(owner),
  //   },
  // });

  return (
    <></>
    // <Modal
    //   header={"Edit Owner"}
    //   open={true}
    //   close={cancel}
    //   submit={form.handleSubmit(async (data) => {
    //     await save(data.owner);
    //     mutate();
    //   })}
    //   cta="Save"
    // >
    //   <label>Owner</label>
    //   <MultiSelectField
    //     options={
    //       tagOptions.map((t) => {
    //         return {
    //           value: t.id,
    //           label: t.id,
    //           color: t.color,
    //           tooltip: t.description,
    //         };
    //       }) ?? []
    //     }
    //     value={value}
    //     onChange={(value: string[]) => {
    //       onChange(value.filter((t) => t.length > 0));
    //     }}
    //     closeMenuOnSelect={closeMenuOnSelect}
    //     autoFocus={autoFocus}
    //     customStyles={tagStyles}
    //     placeholder={prompt}
    //     creatable={creatable}
    //   />
    //   <div style={{ height: 200 }} />
    // </Modal>
  );
};

export default EditTagsForm;
