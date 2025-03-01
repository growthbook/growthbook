import { FC } from "react";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import SelectOwner from "./SelectOwner";

const EditOwnerModal: FC<{
  owner: string;
  save: (ownerName: string) => Promise<void>;
  cancel: () => void;
  mutate: () => void;
  resourceType: React.ComponentProps<typeof SelectOwner>["resourceType"];
}> = ({ owner, save, cancel, mutate, resourceType }) => {
  const form = useForm({
    defaultValues: {
      owner,
    },
  });

  return (
    <Modal
      trackingEventModalType=""
      header={"Edit Owner"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.owner);
        mutate();
      })}
      cta="Save"
    >
      <SelectOwner
        resourceType={resourceType}
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
    </Modal>
  );
};

export default EditOwnerModal;
