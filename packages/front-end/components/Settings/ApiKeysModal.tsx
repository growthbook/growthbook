import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  getRoles,
  RequesterExtension,
  requesterExtension,
} from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgLimits from "@/hooks/useOrgLimits";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import {
  RoleRulesValue,
  clearRequesterOnly,
} from "@/components/Settings/Team/roleRules";
import Checkbox from "@/ui/Checkbox";
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
  const { orgSupportsRoles } = useOrgLimits();

  // When an existing key is passed in, the modal edits that key in place
  // instead of creating a new one.
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
    // is only used when creating a brand-new key or scoping an unscoped PAT.
    role:
      existingKey && (!personalAccessToken || existingKey.scoped)
        ? existingKey.role || "admin"
        : defaultRole,
    limitAccessByEnvironment: existingKey?.limitAccessByEnvironment ?? false,
    environments: existingKey?.environments ?? [],
    requesterOnly: existingKey?.requesterOnly,
    additionalRoles: existingKey?.additionalRoles,
    projectRoles: existingKey?.projectRoles,
  });
  const [requireRequestedBy, setRequireRequestedBy] = useState(
    !!existingKey?.requireRequestedBy,
  );
  const [extension, setExtension] = useState<RequesterExtension>(() =>
    requesterExtension(existingKey ?? {}),
  );
  const [scoped, setScoped] = useState(!!existingKey?.scoped);
  // Gated like org-key roles; with only the admin role there is nothing to narrow to.
  // An already-scoped token stays visible after a downgrade so the scope isn't silently dropped.
  const canScopeToken =
    personalAccessToken && (orgSupportsRoles() || !!existingKey?.scoped);

  const onSubmit = form.handleSubmit(async (value) => {
    // Rules keep their Applies choice while the column is hidden, in case it
    // comes back before saving; only "For specific permissions" saves it.
    const { role, ...rest } =
      extension === "specific" ? roleState : clearRequesterOnly(roleState);
    const patScope = scoped ? { scopedRole: role, ...rest } : {};
    const orgKeyFields = {
      ...rest,
      // Explicit, so clearing the flag on the main role sticks.
      requesterOnly: !!rest.requesterOnly,
      requireRequestedBy,
      extendWithRequester: extension === "all",
    };

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          ...(personalAccessToken ? patScope : { role, ...orgKeyFields }),
        }),
      });
      track("Edit API Key", {
        isSecret: !personalAccessToken,
        ...(personalAccessToken ? { scoped } : {}),
      });
      onCreate();
      return;
    }

    const key = personalAccessToken
      ? {
          description: value.description,
          type: "user",
          ...patScope,
        }
      : {
          description: value.description,
          type: role,
          ...orgKeyFields,
        };
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(key),
    });
    track("Create API Key", {
      isSecret: !personalAccessToken,
      ...(personalAccessToken ? { scoped } : {}),
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
      {canScopeToken && (
        <Box mt="6">
          <Heading as="h4" size="sm" mb="1">
            Permissions
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            {scoped
              ? "What this token can do. It only gets what both your own permissions and the rules below allow."
              : "This token can do anything you can."}
          </Text>
          <Checkbox
            label="Limit this token's permissions"
            value={scoped}
            setValue={setScoped}
          />
          {scoped && (
            <Box mt="3">
              <RoleRulesTable value={roleState} setValue={setRoleState} />
            </Box>
          )}
        </Box>
      )}
      {!personalAccessToken && (
        <>
          <RequestedByFields
            required={requireRequestedBy}
            setRequired={setRequireRequestedBy}
            extension={extension}
            setExtension={setExtension}
          />
          <Box mt="6">
            <Heading as="h4" size="sm" mb="1">
              Permissions
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              {extension === "specific"
                ? "What requests made with this key can do. Rules set to “If the requester has it” only grant permissions the requester already has."
                : extension === "all"
                  ? "What every request made with this key can do. A request that names a member can also do anything that member can."
                  : "What every request made with this key can do."}
            </Text>
            <RoleRulesTable
              value={roleState}
              setValue={setRoleState}
              showAppliesColumn={extension === "specific"}
            />
          </Box>
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
