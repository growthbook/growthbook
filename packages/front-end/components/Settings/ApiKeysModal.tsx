import { FC, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  assumesRequesterRole,
  getRoles,
  requesterHeaderPolicy,
} from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { MemberRoleWithProjects } from "shared/types/organization";
import {
  getExpirationProblem,
  latestEditedExpiration,
} from "shared/api-key-expiration";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgLimits from "@/hooks/useOrgLimits";
import track from "@/services/track";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import RequestedByFields from "@/components/Settings/RequestedByFields";
import ApiKeyExpirationField from "./ApiKeyExpirationField";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  personalAccessToken: boolean;
  defaultDescription?: string;
  existingKey?: ApiKeyInterface;
  /** Seeds a new key with this one's settings; it still gets its own value and expiry. */
  copyFrom?: ApiKeyInterface;
  /** Offers to delete `copyFrom` once the copy exists; omit when the user can't. */
  onDeleteCopySource?: () => Promise<void>;
}> = ({
  close,
  personalAccessToken,
  onCreate,
  defaultDescription = "",
  existingKey,
  copyFrom,
  onDeleteCopySource,
}) => {
  const { apiCall } = useAuth();
  const { organization, settings } = useUser();
  const { orgSupportsRoles } = useOrgLimits();

  const maxLifetimeDays = personalAccessToken
    ? settings?.maxPatLifetimeDays
    : settings?.maxApiKeyLifetimeDays;
  const [expiresAt, setExpiresAt] = useState<Date | null>(() =>
    existingKey?.expiresAt ? new Date(existingKey.expiresAt) : null,
  );
  // An edit sends the expiry only when it moved, so a permissions-only save
  // never trips over a key that predates the policy.
  const expirationChanged =
    (expiresAt?.getTime() ?? null) !==
    (existingKey?.expiresAt ? new Date(existingKey.expiresAt).getTime() : null);
  // The field explains each of these inline, so Save just stays out of reach.
  const expirationProblem = getExpirationProblem(
    expiresAt,
    maxLifetimeDays,
    new Date(),
    existingKey
      ? latestEditedExpiration(
          existingKey.expiresAt,
          existingKey.dateCreated,
          maxLifetimeDays,
        )
      : undefined,
  );

  // When an existing key is passed in, the modal edits that key in place
  // instead of creating a new one.
  const editMode = !!existingKey;
  const source = existingKey ?? copyFrom;
  const canDeleteSource = !!copyFrom && !!onDeleteCopySource;
  const [deleteSource, setDeleteSource] = useState(true);
  // A retry after a failed delete must not mint a second copy.
  const created = useRef(false);

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
      description: source?.description ?? defaultDescription,
    },
  });

  const [roleState, setRoleState] = useState<MemberRoleWithProjects>({
    // When editing or copying, seed the role from that key rather than the generic
    // defaultRole. Legacy secret keys created before per-key roles have no
    // stored role and resolve to "admin" at auth time (see roleForApiKey); the
    // API already serializes that effective role onto the key, so existingKey.role
    // is normally populated. We still fall back to "admin" (the same effective
    // role) — never defaultRole — if it's ever empty, so a description/scope-only
    // edit of a legacy key can't silently downgrade its permissions. defaultRole
    // is only used when creating a brand-new key or scoping an unscoped PAT.
    role:
      source && (!personalAccessToken || source.scoped)
        ? source.role || "admin"
        : defaultRole,
    limitAccessByEnvironment: source?.limitAccessByEnvironment ?? false,
    environments: source?.environments ?? [],
    additionalRoles: source?.additionalRoles,
    projectRoles: source?.projectRoles,
  });
  const [requesterHeader, setRequesterHeader] = useState(
    requesterHeaderPolicy(source ?? {}),
  );
  const [requesterPermissions, setRequesterPermissions] = useState<
    NonNullable<ApiKeyInterface["requesterPermissions"]>
  >(assumesRequesterRole(source ?? {}) ? "assume" : "key");
  const [scoped, setScoped] = useState(!!source?.scoped);
  // Gated like org-key roles; with only the admin role there is nothing to narrow to.
  // An already-scoped token stays visible after a downgrade so the scope isn't silently dropped.
  const canScopeToken =
    personalAccessToken && (orgSupportsRoles() || !!source?.scoped);

  const onSubmit = form.handleSubmit(async (value) => {
    const { role, ...rest } = roleState;
    const patScope = scoped ? { scopedRole: role, ...rest } : {};
    const orgKeyFields = { ...rest, requesterHeader, requesterPermissions };

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          ...(personalAccessToken ? patScope : { role, ...orgKeyFields }),
          ...(expirationChanged && {
            expiresAt: expiresAt?.toISOString() ?? null,
          }),
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
          expiresAt: expiresAt?.toISOString() ?? null,
        }
      : {
          description: value.description,
          type: role,
          ...orgKeyFields,
          expiresAt: expiresAt?.toISOString() ?? null,
        };
    if (!created.current) {
      await apiCall("/keys", {
        method: "POST",
        body: JSON.stringify(key),
      });
      created.current = true;
      track("Create API Key", {
        isSecret: !personalAccessToken,
        ...(personalAccessToken ? { scoped } : {}),
      });
      onCreate();
    }
    if (canDeleteSource && deleteSource && onDeleteCopySource) {
      try {
        await onDeleteCopySource();
      } catch (e) {
        throw new Error(
          `The new key was created, but the original couldn't be deleted: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
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
      ctaEnabled={!expirationProblem || (editMode && !expirationChanged)}
    >
      <TextField
        label="Description"
        labelSize="lg"
        required
        mb="3"
        {...form.register("description")}
      />
      <ApiKeyExpirationField
        maxLifetimeDays={maxLifetimeDays}
        value={expiresAt}
        setValue={setExpiresAt}
        existing={existingKey}
      />
      {canDeleteSource && (
        <Box mt="3">
          <Checkbox
            value={deleteSource}
            setValue={setDeleteSource}
            label={`Delete "${copyFrom?.description || copyFrom?.id}" once the new key is created`}
          />
        </Box>
      )}
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
            header={requesterHeader}
            setHeader={setRequesterHeader}
            permissions={requesterPermissions}
            setPermissions={setRequesterPermissions}
          />
          <Box mt="6">
            <Heading as="h4" size="sm" mb="1">
              Permissions
            </Heading>
            <Text as="p" color="text-mid" mb="3">
              What every request made with this key can do.
              {requesterHeader !== "rejected" &&
                requesterPermissions === "assume" &&
                " A request that names a member can only do what both this key and that member can."}
            </Text>
            <RoleRulesTable value={roleState} setValue={setRoleState} />
          </Box>
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
