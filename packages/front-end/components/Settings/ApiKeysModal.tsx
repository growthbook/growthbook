import { FC, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  getExpirationProblem,
  latestEditedExpiration,
} from "shared/api-key-expiration";
import { Box, Grid } from "@radix-ui/themes";
import { PiArrowSquareOut, PiHardDrives, PiUser } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";
import ApiKeyExpirationField from "./ApiKeyExpirationField";
import PermissionsField, { useAllowedPermissions } from "./PermissionsField";
import {
  forHolder,
  initialPermissions,
  isComplete,
  orgKeyFields,
  rulesProblem,
  tokenFields,
} from "./apiKeyPermissions";

type ActAs = NonNullable<ApiKeyInterface["actAs"]>;

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
  const { settings } = useUser();
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

  const form = useForm<{
    description: string;
  }>({
    defaultValues: {
      description: source?.description ?? defaultDescription,
    },
  });

  const [actAs, setActAs] = useState<ActAs>(source?.actAs ?? "system");
  const holder = personalAccessToken ? "pat" : actAs;
  const plan = useAllowedPermissions();
  // An already-scoped token keeps its scope after a downgrade, so it isn't silently dropped.
  // Likewise a key keeps editing the confirmations it has, as the server allows.
  const allowed = {
    ...plan,
    roles: plan.roles || !!source?.scoped,
    confirmations: plan.confirmations || !!existingKey?.confirmRules,
  };
  const [permissions, setPermissions] = useState(() =>
    initialPermissions(source, holder, allowed),
  );

  const onSubmit = form.handleSubmit(async (value) => {
    const problem = rulesProblem(permissions);
    if (problem) throw new Error(problem);
    const { role, ...orgKeyScope } = {
      ...orgKeyFields(permissions),
      actAs,
    };
    const patScope = tokenFields(permissions);
    const trackProps = {
      isSecret: !personalAccessToken,
      ...(personalAccessToken ? { scoped: !!patScope.scopedRole } : { actAs }),
      permissions: permissions.customizing ? "custom" : permissions.preset,
    };

    if (existingKey) {
      await apiCall(`/keys/${existingKey.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: value.description,
          ...(expirationChanged && {
            expiresAt: expiresAt?.toISOString() ?? null,
          }),
          ...(!authorityLocked &&
            (personalAccessToken ? patScope : { role, ...orgKeyScope })),
        }),
      });
      track("Edit API Key", trackProps);
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
          ...orgKeyScope,
          expiresAt: expiresAt?.toISOString() ?? null,
        };
    if (!created.current) {
      await apiCall("/keys", {
        method: "POST",
        body: JSON.stringify(key),
      });
      created.current = true;
      track("Create API Key", trackProps);
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
      size="lg"
      trackingEventModalType=""
      close={close}
      header={`${editMode ? "Edit" : "Create"} ${personalAccessToken ? "Personal Access Token" : "API Key"}`}
      open={true}
      submit={onSubmit}
      cta={editMode ? "Save" : "Create"}
      ctaEnabled={
        (!expirationProblem || (editMode && !expirationChanged)) &&
        (authorityLocked || isComplete(permissions))
      }
    >
      <Grid
        columns={{ initial: "1fr", sm: "minmax(0, 1fr) 220px" }}
        gapX="4"
        gapY="3"
        align="start"
      >
        <TextField label="Name" required {...form.register("description")} />
        <ApiKeyExpirationField
          maxLifetimeDays={maxLifetimeDays}
          value={expiresAt}
          setValue={setExpiresAt}
          existing={existingKey}
          replaceBlocked={replaceBlocked}
        />
      </Grid>
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
          Changing who this key acts as, its permissions, or its confirmations
          requires permission to create API keys.
        </HelperText>
      )}
      {!authorityLocked && !personalAccessToken && (
        <Box mt="6">
          <Text as="div" size="md" weight="semibold" mb="2">
            Act as
          </Text>
          <RadioCards
            columns="2"
            width="100%"
            labelSize="md"
            descriptionSize="sm"
            truncateDescription={false}
            value={actAs}
            setValue={(next) => {
              setActAs(next as ActAs);
              setPermissions(forHolder(permissions, next as ActAs, allowed));
            }}
            options={[
              {
                value: "system",
                label: "System",
                description: "Not tied to a specific user.",
                avatar: <PiHardDrives size={20} />,
              },
              {
                value: "user",
                label: "User",
                description: "Pass a user in a header to act on their behalf.",
                avatar: <PiUser size={20} />,
              },
            ]}
          />
          {actAs === "user" && (
            <>
              <Text as="p" mt="3" mb="3">
                All requests must have an <code>X-GrowthBook-Requested-By</code>{" "}
                header with email or member ID.
              </Text>
              <Callout status="info">
                GrowthBook supports OAuth 2.0, which might be a better fit than
                a shared API key.{" "}
                <Link
                  href="https://docs.growthbook.io/integrations/mcp"
                  external
                  weight="medium"
                >
                  Learn more <PiArrowSquareOut />
                </Link>
              </Callout>
            </>
          )}
        </Box>
      )}
      {!authorityLocked && (
        <Box mt="6">
          <PermissionsField
            holder={holder}
            value={permissions}
            setValue={setPermissions}
            allowed={allowed}
          />
        </Box>
      )}
    </ModalStandard>
  );
};

export default ApiKeysModal;
