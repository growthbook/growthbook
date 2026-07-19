import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { getRoles } from "shared/permissions";
import { MemberRoleWithProjects } from "shared/types/organization";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleSelector from "@/components/Settings/Team/RoleSelector";
import Callout from "@/ui/Callout";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  personalAccessToken: boolean;
  defaultDescription?: string;
  existingKey?: ApiKeyInterface;
}> = ({
  close,
  personalAccessToken,
  onCreate,
  defaultDescription = "",
  existingKey,
}) => {
  const { apiCall } = useAuth();
  const { organization } = useUser();

  // When an existing key is passed in, the modal edits that key in place
  // instead of creating a new one. Only org secret keys can be edited.
  const editMode = !!existingKey;

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
    // In edit mode, seed the role from the existing key rather than the generic
    // defaultRole. Legacy secret keys created before per-key roles have no
    // stored role and resolve to "admin" at auth time (see roleForApiKey); the
    // API already serializes that effective role onto the key, so existingKey.role
    // is normally populated. We still fall back to "admin" (the same effective
    // role) — never defaultRole — if it's ever empty, so a description/scope-only
    // edit of a legacy key can't silently downgrade its permissions. defaultRole
    // is only used when creating a brand-new key.
    role: existingKey ? existingKey.role || "admin" : defaultRole,
    limitAccessByEnvironment: existingKey?.limitAccessByEnvironment ?? false,
    environments: existingKey?.environments ?? [],
    // Leave undefined when absent (matches create): sending an empty array
    // would trip the advanced-permissions premium gate in customValidation.
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
        }),
      });
      track("Edit API Key");
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
      header={editMode ? "Edit API Key" : "Create API Key"}
      open={true}
      submit={onSubmit}
      cta={editMode ? "Save" : "Create"}
    >
      <Field
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {!personalAccessToken && (
        <>
          {editMode && (
            <Callout status="info" mb="3">
              <Box mb="2">
                Editing permissions keeps the same key value, so existing
                integrations keep working.
              </Box>
              <Box>
                We recommend rotating instead (delete and recreate) when
                it&apos;s not too disruptive &mdash; the key&apos;s scope is
                baked into its name, so the name may be misleading after an
                edit.
              </Box>
            </Callout>
          )}
          <RoleSelector
            value={roleState}
            setValue={setRoleState}
            isNewAssignment={!editMode}
          />
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
