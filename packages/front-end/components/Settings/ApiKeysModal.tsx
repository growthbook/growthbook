import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { getRoles, hasRequesterOnlyRules } from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import { RoleRulesValue } from "@/components/Settings/Team/roleRules";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import RequestedByFields from "@/components/Settings/RequestedByFields";

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

  const [roleState, setRoleState] = useState<RoleRulesValue>({
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
    requesterOnly: existingKey?.requesterOnly,
    additionalRoles: existingKey?.additionalRoles,
    projectRoles: existingKey?.projectRoles,
  });
  const [requireRequestedBy, setRequireRequestedBy] = useState(
    !!existingKey?.requireRequestedBy,
  );
  const [extendWithRequester, setExtendWithRequester] = useState(() =>
    hasRequesterOnlyRules(existingKey ?? {}),
  );
  const hasRequesterRows = hasRequesterOnlyRules(roleState);

  const onSubmit = form.handleSubmit(async (value) => {
    const { role, ...rest } = roleState;
    // Explicit, so clearing the flag on the main role sticks.
    const roleStateData = { ...rest, requesterOnly: !!rest.requesterOnly };

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          role,
          ...roleStateData,
          requireRequestedBy,
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
          requireRequestedBy,
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
      size="xl"
      trackingEventModalType=""
      close={close}
      header={editMode ? "Edit API Key" : "Create API Key"}
      open={true}
      submit={onSubmit}
      cta={editMode ? "Save" : "Create"}
    >
      <Field
        size="legacy"
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {!personalAccessToken && (
        <>
          <RequestedByFields
            required={requireRequestedBy}
            setRequired={setRequireRequestedBy}
            extendWithRequester={extendWithRequester}
            setExtendWithRequester={setExtendWithRequester}
            hasRequesterRows={hasRequesterRows}
          />
          <Box mt="6">
            <Heading as="h4" size="sm" mb="1">
              Permissions
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              {extendWithRequester
                ? "What requests made with this key can do. Rules that apply only if the requester has it go no further than the requester's own permissions."
                : "What every request made with this key can do."}
            </Text>
            <RoleRulesTable
              value={roleState}
              setValue={setRoleState}
              showAppliesColumn={extendWithRequester}
            />
          </Box>
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
