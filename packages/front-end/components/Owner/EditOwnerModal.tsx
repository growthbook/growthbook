import { FC } from "react";
import { useForm } from "react-hook-form";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import SelectOwner from "./SelectOwner";

const EditOwnerModal: FC<{
  owner: string;
  save: (ownerName: string) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
}> = ({ owner, save, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      owner,
    },
  });

  return (
    <DialogLayout
      trackingEventModalType=""
      header="Edit Owner"
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.owner);
        mutate();
      })}
      cta="Save"
    >
      <SelectOwner
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
    </DialogLayout>
  );
};

export default EditOwnerModal;
