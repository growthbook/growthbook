import { FC, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { getRoles } from "shared/permissions";
import { MemberRoleWithProjects } from "shared/types/organization";
import { ApiKeyInterface } from "shared/types/apikey";
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
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
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
  const [scoped, setScoped] = useState(!!source?.scoped);
  // Gated like org-key roles; with only the admin role there is nothing to narrow to.
  // An already-scoped token stays visible after a downgrade so the scope isn't silently dropped.
  const canScopeToken =
    personalAccessToken && (orgSupportsRoles() || !!source?.scoped);

  const onSubmit = form.handleSubmit(async (value) => {
    const { role, ...roleStateData } = roleState;
    const patScope = scoped ? { scopedRole: role, ...roleStateData } : {};

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          ...(personalAccessToken ? patScope : { role, ...roleStateData }),
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
          ...roleStateData,
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
        <Box mb="3">
          <Checkbox
            value={deleteSource}
            setValue={setDeleteSource}
            label={`Delete "${copyFrom?.description || copyFrom?.id}" once the new key is created`}
          />
        </Box>
      )}
      {canScopeToken && (
        <>
          <Checkbox
            label="Limit this token's permissions"
            description="The token can never do more than you can: it gets only what both your own role and these settings allow."
            value={scoped}
            setValue={setScoped}
            mb="3"
          />
          {scoped && (
            <RoleRulesTable value={roleState} setValue={setRoleState} />
          )}
        </>
      )}
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
          <RoleRulesTable value={roleState} setValue={setRoleState} />
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
