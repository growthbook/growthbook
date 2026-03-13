import { FC, useMemo } from "react";
import { useForm } from "react-hook-form";
import { DEFAULT_ROLES, getRoles } from "shared/permissions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  personalAccessToken: boolean;
  defaultDescription?: string;
}> = ({ close, personalAccessToken, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const { organization, hasCommercialFeature } = useUser();
  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");

  const groupedRoles = useMemo(() => {
    const roleList = getRoles(organization);
    const deactivatedRoles = hasCustomRolesFeature
      ? (organization.deactivatedRoles ?? [])
      : [];
    const defaultRoles = {
      label: "Default Roles",
      options: roleList
        .filter(
          (role) =>
            !deactivatedRoles.includes(role.id) && role.id in DEFAULT_ROLES,
        )
        .map((role) => ({
          label: role.displayName || role.id,
          value: role.id,
        })),
    };
    const customRoles = {
      label: "Custom Roles",
      options: hasCustomRolesFeature
        ? roleList
            .filter(
              (role) =>
                !deactivatedRoles.includes(role.id) &&
                !(role.id in DEFAULT_ROLES) &&
                role.id !== "noaccess",
            )
            .map((role) => ({
              label: role.displayName || role.id,
              value: role.id,
            }))
        : [],
    };
    return [defaultRoles, customRoles];
  }, [organization, hasCustomRolesFeature]);

  const form = useForm<{
    description: string;
    type: string;
  }>({
    defaultValues: {
      description: defaultDescription,
      type: personalAccessToken
        ? "user"
        : (groupedRoles[0].options[0]?.value ??
          groupedRoles[1].options[0]?.value ??
          ""),
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        ...value,
      }),
    });
    track("Create API Key", {
      isSecret: value.type !== "user",
    });
    onCreate();
  });

  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header={"Create API Key"}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <Field
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {!personalAccessToken && (
        <SelectField
          label="Role"
          value={form.watch("type")}
          onChange={(v) => form.setValue("type", v)}
          options={groupedRoles}
          sort={false}
        />
      )}
    </Modal>
  );
};

export default ApiKeysModal;
