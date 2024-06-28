import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";

const EditOrganizationModal: FC<{
  name: string;
  ownerEmail: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, name, ownerEmail }) => {
  const { apiCall, setOrgName } = useAuth();

  const permissions = usePermissions();
  const canEditOwner = permissions.check("organizationSettings");

  const form = useForm({
    defaultValues: {
      name,
      ownerEmail,
    },
  });

  return (
    <Modal
      header="Edit Organization"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        if (
          !value?.name ||
          value?.name.trim() === "" ||
          value?.name === undefined
        ) {
          throw new Error("Organization name cannot be empty");
        }
        if (!value?.ownerEmail || value.ownerEmail.trim() === "") {
          throw new Error("Owner email cannot be empty");
        } else {
          const newDomain = value.ownerEmail.trim().split("@")[1];
          const oldDomain = ownerEmail.trim().split("@")[1];
          if (newDomain !== oldDomain) {
            throw new Error(
              "For account security, the owner email domain cannot be changed though the UI. Please contact support for help with account transfers."
            );
          }
        }
        await apiCall("/organization", {
          method: "PUT",
          body: JSON.stringify(value),
        });
        // Update org name in global context (e.g. top nav)
        if (setOrgName) {
          setOrgName(value.name);
        }
        // Update org name on settings page
        await mutate();
      })}
      cta="Save"
    >
      <Field label="Organization Name" required {...form.register("name")} />
      <Field
        label={"Owner Email"}
        type="email"
        {...form.register("ownerEmail")}
        disabled={!canEditOwner}
        title={canEditOwner ? "" : "Only admins can change this"}
      />
    </Modal>
  );
};
export default EditOrganizationModal;
