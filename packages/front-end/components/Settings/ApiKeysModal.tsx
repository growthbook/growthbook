import { FC, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  assumesRequesterRole,
  getRoles,
  requesterHeaderPolicy,
} from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { ConfirmRule } from "shared/validators";
import { MemberRoleWithProjects } from "shared/types/organization";
import {
  getExpirationProblem,
  latestEditedExpiration,
} from "shared/api-key-expiration";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import { useUser } from "@/services/UserContext";
import useOrgLimits from "@/hooks/useOrgLimits";
import track from "@/services/track";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import RequestedByFields from "@/components/Settings/RequestedByFields";
import ApiKeyExpirationField from "./ApiKeyExpirationField";
import ConfirmRulesField, {
  SUGGESTED_CONFIRM_RULES,
} from "./ConfirmRulesField";
import { ALL, mergeConfirmRules, presetOf } from "./confirmRulesUtils";

const PRESET_HELP = {
  recommended: (
    <Flex as="span" direction="column" gap="2">
      <span>
        Waits for confirmation before publishing, archiving or deleting,
        changing live experiments or ramps, skipping checks, or editing
        settings, access, environments, SDK Connections, metrics and the like.
      </span>
      <span>
        Creating things, working on drafts, AI Visual Editor changes, and writes
        like dashboards and comments run without confirmation.
      </span>
    </Flex>
  ),
  all: "Waits for confirmation before every write, including creating things and drafts. Only reads and calculations run without confirmation.",
};

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
  const canCreateApiKey = usePermissionsUtil().canCreateApiKey();
  const replaceBlocked = personalAccessToken
    ? settings?.disablePersonalAccessTokens
      ? "Personal access tokens are disabled for your organization. Contact an admin if you need API access."
      : null
    : canCreateApiKey
      ? null
      : "Replacing it requires permission to create a new one.";

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
          existingKey.keyIssuedAt ?? existingKey.dateCreated,
          maxLifetimeDays,
        )
      : undefined,
  );

  // When an existing key is passed in, the modal edits that key in place
  // instead of creating a new one.
  const editMode = !!existingKey;
  // Changing what an org key can do takes permission to create keys.
  const authorityLocked = editMode && !personalAccessToken && !canCreateApiKey;
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
  const [requireConfirmation, setRequireConfirmation] = useState(
    !!source?.confirmRules,
  );
  // Kept while the checkbox is off, so turning it back on restores the edits.
  // Saved rules load in the picker's own terms.
  const [rules, setRules] = useState<ConfirmRule[]>(() =>
    source?.confirmRules
      ? mergeConfirmRules(source.confirmRules)
      : SUGGESTED_CONFIRM_RULES,
  );
  // The editor stays tucked away until asked for, unless this key already has
  // rules beyond a preset.
  const [customizing, setCustomizing] = useState(
    () => !!source?.confirmRules && !presetOf(rules),
  );
  const allActions = presetOf(rules) === ALL;
  // Gated like org-key roles; with only the admin role there is nothing to narrow to.
  // An already-scoped token stays visible after a downgrade so the scope isn't silently dropped.
  const canScopeToken =
    personalAccessToken && (orgSupportsRoles() || !!source?.scoped);

  const onSubmit = form.handleSubmit(async (value) => {
    if (requireConfirmation && rules.some((rule) => !rule.actions.length)) {
      throw new Error("Choose at least one action for each confirmation rule.");
    }
    const confirmRules = requireConfirmation ? mergeConfirmRules(rules) : null;
    const { role, ...rest } = roleState;
    const patScope = scoped ? { scopedRole: role, ...rest } : {};
    const orgKeyFields = { ...rest, requesterHeader, requesterPermissions };

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          ...(expirationChanged && {
            expiresAt: expiresAt?.toISOString() ?? null,
          }),
          ...(!authorityLocked && {
            ...(personalAccessToken ? patScope : { role, ...orgKeyFields }),
            confirmRules,
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
          confirmRules,
        }
      : {
          description: value.description,
          type: role,
          ...orgKeyFields,
          expiresAt: expiresAt?.toISOString() ?? null,
          confirmRules,
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
        replaceBlocked={replaceBlocked}
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
      {authorityLocked && (
        <HelperText status="info" mt="6">
          Changing this key&apos;s permissions, requester settings, or
          confirmations requires permission to create API keys.
        </HelperText>
      )}
      {!authorityLocked && (
        <Box mt="6">
          <Heading as="h4" size="sm" mb="1">
            Human-in-the-Loop
          </Heading>
          <Text as="p" color="text-mid" mb="3">
            Risky actions wait for a person to confirm them.
          </Text>
          <Checkbox
            label="Require confirmation"
            value={requireConfirmation}
            setValue={setRequireConfirmation}
          />
          {requireConfirmation && !customizing && (
            <Flex align="center" gap="1" pl="5" mt="2">
              <Text color="text-mid">
                Requires confirmation for{" "}
                <Tooltip
                  content={
                    allActions ? PRESET_HELP.all : PRESET_HELP.recommended
                  }
                >
                  <strong tabIndex={0}>
                    {allActions ? "all" : "recommended"} actions{" "}
                    <PiInfo style={{ position: "relative", top: "-1px" }} />
                  </strong>
                </Tooltip>
              </Text>
              <Link ml="2" weight="medium" onClick={() => setCustomizing(true)}>
                Customize behavior
              </Link>
            </Flex>
          )}
          {requireConfirmation && customizing && (
            <Box mt="3">
              <ConfirmRulesField
                value={rules}
                // Removing every rule goes back to the recommended ones.
                setValue={(next) => {
                  setRules(next.length ? next : SUGGESTED_CONFIRM_RULES);
                  if (!next.length) setCustomizing(false);
                }}
              />
            </Box>
          )}
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
              <RoleRulesTable
                value={roleState}
                setValue={setRoleState}
                forApiKey
              />
            </Box>
          )}
        </Box>
      )}
      {!personalAccessToken && !authorityLocked && (
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
              What every request made with this key can do
              {requesterHeader !== "rejected" &&
                requesterPermissions === "assume" &&
                " (subject to the requester's own permissions)"}
              .
            </Text>
            <RoleRulesTable
              value={roleState}
              setValue={setRoleState}
              forApiKey
            />
          </Box>
        </>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
