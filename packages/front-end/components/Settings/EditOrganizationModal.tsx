import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const EditOrganizationModal: FC<{
  name: string;
  ownerEmail: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, name, ownerEmail }) => {
  const { apiCall, setOrgName } = useAuth();
  const { users } = useUser();
  const existingEmails = Array.from(users).map(([, user]) => user.email);
  const permissions = usePermissionsUtil();
  const canEdit = permissions.canManageOrgSettings();

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
        if (!canEdit) {
          throw new Error(
            "You do not have permissions to edit this organization"
          );
        }
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
          if (!existingEmails.includes(value.ownerEmail.trim())) {
            throw new Error(
              "This email is not associated with any user in your organization"
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
      <Field
        label="Organization Name"
        required
        {...form.register("name")}
        disabled={!canEdit}
      />
      {existingEmails.length < 100 ? (
        <SelectField
          label="Owner Email"
          value={form.watch("ownerEmail")}
          options={
            existingEmails.map((e) => ({
              value: e,
              label: e,
            })) ?? []
          }
          disabled={!canEdit}
          title={canEdit ? "" : "Only admins can change this"}
          onChange={(value) => {
            form.setValue("ownerEmail", value);
          }}
        />
      ) : (
        <Field
          label="Owner Email"
          type="email"
          {...form.register("ownerEmail")}
          disabled={!canEdit}
          title={canEdit ? "" : "Only admins can change this"}
        />
      )}
    </Modal>
  );
};
export default EditOrganizationModal;
