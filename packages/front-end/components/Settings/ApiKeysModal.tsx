import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { getRoles } from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { MemberRoleWithProjects } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import RoleSelector from "@/components/Settings/Team/RoleSelector";

const ApiKeysModal: FC<
  {
    close: () => void;
    onCreate: () => void;
    defaultDescription?: string;
  } & ( // PATs have no editable permissions, so edit mode is org-keys only
    | { personalAccessToken: true; existingKey?: never }
    | {
        personalAccessToken: false;
        // When set, the modal edits this key's description and permissions in place
        existingKey?: ApiKeyInterface;
      }
  )
> = ({
  close,
  personalAccessToken,
  onCreate,
  defaultDescription = "",
  existingKey,
}) => {
  const { apiCall } = useAuth();
  const { organization } = useUser();

  const defaultRole = useMemo(() => {
    const deactivated = new Set(organization.deactivatedRoles ?? []);
    const roles = getRoles(organization);
    return (
      roles.find((r) => r.id !== "noaccess" && !deactivated.has(r.id))?.id ??
      "readonly"
    );
  }, [organization]);

  const form = useForm<{
    description: string;
  }>({
    defaultValues: {
      description: existingKey?.description ?? defaultDescription,
    },
  });

  const [roleState, setRoleState] = useState<MemberRoleWithProjects>({
    role: existingKey?.role ?? defaultRole,
    limitAccessByEnvironment: existingKey?.limitAccessByEnvironment ?? false,
    environments: existingKey?.environments ?? [],
    projectRoles: existingKey?.projectRoles,
  });

  const onSubmit = form.handleSubmit(async (value) => {
    const { role, ...roleStateData } = roleState;
    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          role,
          ...roleStateData,
          projectRoles: roleStateData.projectRoles ?? [],
        }),
      });
      track("Update API Key");
      onCreate();
      return;
    }
    const key = personalAccessToken
      ? {
          description: value.description,
          type: "user",
        }
      : {
          description: value.description,
          type: role,
          ...roleStateData,
        };
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(key),
    });
    track("Create API Key", {
      isSecret: !personalAccessToken,
    });
    onCreate();
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header={existingKey ? "Edit API Key" : "Create API Key"}
      open={true}
      submit={onSubmit}
      cta={existingKey ? "Save" : "Create"}
    >
      <Field
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {!personalAccessToken && (
        <RoleSelector value={roleState} setValue={setRoleState} />
      )}
      {existingKey && (
        <Callout status="info" mt="3">
          Changes apply to the key&apos;s next request. The key value stays the
          same, so nothing needs to be rotated (the role name embedded in the
          key string is cosmetic and may no longer match).
        </Callout>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
