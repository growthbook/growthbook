import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import { isCloud, isMultiOrg } from "@/services/env";

const EditOrganizationModal: FC<{
  name: string;
  installationName?: string;
  ownerEmail: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, name, installationName, ownerEmail }) => {
  const { apiCall, setOrgName } = useAuth();
  const { users, license } = useUser();
  const existingEmails = Array.from(users).map(([, user]) => user.email);
  const permissions = usePermissions();
  const canEdit = permissions.check("organizationSettings");

  const showInstallationName =
    license?.plan === "enterprise" && !isCloud() && isMultiOrg();

  const installationChartIsShowing =
    !isCloud() &&
    license?.plan === "enterprise" &&
    Object.keys(license?.installationUsers || {}).length > 1;

  const form = useForm({
    defaultValues: {
      name,
      ...(showInstallationName && { installationName }),
      ownerEmail,
    },
  });

  return (
    <Modal
      trackingEventModalType=""
      header="Edit Organization"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        if (!canEdit) {
          throw new Error(
            "You do not have permissions to edit this organization",
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
              "This email is not associated with any user in your organization",
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

        if (installationChartIsShowing) {
          // Force refresh license data so that the installation chart is immediately updated
          try {
            await apiCall("/license", {
              method: "GET",
            });
          } catch (e) {
            // The org data was successfully updated so we can ignore any errors here
            console.warn("Failed to refresh license:", e);
          }
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
      {showInstallationName && (
        <Field
          label="Installation Name"
          required
          {...form.register("installationName")}
          disabled={!canEdit}
        />
      )}

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
