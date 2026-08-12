import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import {
  AIModel,
  AIModelSettingKey,
  AIProvider,
  AI_PROVIDERS,
  AI_PROVIDER_META,
  getAIModelSettingsUsingProvider,
  getProviderForAIModel,
} from "shared/ai";
import { AICredentialFrontEndInterface } from "shared/validators";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { getModelDisplayLabel } from "@/services/aiModelSelectOptions";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import PremiumCallout from "@/ui/PremiumCallout";

type AICredentialsResponse = {
  credentials: AICredentialFrontEndInterface[];
  envProviders: AIProvider[];
  canUseOwnKeys: boolean;
};

export function useAIProviderKeys() {
  const { data, error, mutate, isLoading } =
    useApi<AICredentialsResponse>("/ai/credentials");

  const credentials = data?.credentials ?? [];
  const envProviders = data?.envProviders ?? [];
  const canUseOwnKeys = !!data?.canUseOwnKeys;

  const hasOwnKeyForProvider = (provider: AIProvider): boolean =>
    canUseOwnKeys && credentials.some((c) => c.provider === provider);

  const hasKeyForProvider = (provider: AIProvider): boolean =>
    hasOwnKeyForProvider(provider) || envProviders.includes(provider);

  const hasKeyForModel = (model: AIModel | string): boolean => {
    const provider = getProviderForAIModel("text", model);
    return provider !== null && hasKeyForProvider(provider);
  };

  const hasOwnKey = AI_PROVIDERS.some(hasOwnKeyForProvider);

  return {
    credentials,
    envProviders,
    canUseOwnKeys,
    hasOwnKeyForProvider,
    hasKeyForProvider,
    hasKeyForModel,
    hasAnyKey: AI_PROVIDERS.some(hasKeyForProvider),
    hasOwnKey,
    canChooseModels: !isCloud() || hasOwnKey,
    selectableProviders: data
      ? AI_PROVIDERS.filter((p) =>
          isCloud() ? hasOwnKeyForProvider(p) : hasKeyForProvider(p),
        )
      : undefined,
    mutate,
    isLoading,
    error,
    loaded: !!data,
  };
}

export type AIProviderAccess = ReturnType<typeof useAIProviderKeys>;

function ProviderRow({
  provider,
  credential,
  inheritedFromEnv,
  canEdit,
  canUseOwnKeys,
  aiEnabled,
  startEditing = false,
  onCancelAdd,
  onChanged,
  onCleared,
}: {
  provider: AIProvider;
  credential?: AICredentialFrontEndInterface;
  inheritedFromEnv: boolean;
  canEdit: boolean;
  canUseOwnKeys: boolean;
  aiEnabled: boolean;
  onCleared?: (keys: AIModelSettingKey[]) => void;
  startEditing?: boolean;
  onCancelAdd?: () => void;
  onChanged: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { label, keyPlaceholder, consoleUrl, envVar } =
    AI_PROVIDER_META[provider];

  const envIsAuthoritative = inheritedFromEnv && !isCloud();

  const managedByGrowthBook = inheritedFromEnv && isCloud() && !credential;

  const inactiveForPlan = !!credential && !canUseOwnKeys;

  const { settings } = useUser();
  const affectedSettings = isCloud()
    ? getAIModelSettingsUsingProvider(settings ?? {}, provider)
    : [];

  const [editing, setEditing] = useState(startEditing);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const save = async () => {
    setError(null);
    setWarning(null);
    setSaving(true);
    try {
      const res = await apiCall<{ warning?: string }>(
        `/ai/credentials/${provider}`,
        {
          method: "PUT",
          body: JSON.stringify({ apiKey }),
        },
      );
      setApiKey("");
      setEditing(false);
      if (res?.warning) setWarning(res.warning);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    setWarning(null);
    await apiCall(`/ai/credentials/${provider}`, { method: "DELETE" });
    setConfirmingRemove(false);
    onCleared?.(affectedSettings.map((s) => s.key));
    await onChanged();
  };

  return (
    <Frame p="3" mb="3">
      <Flex align="center" gap="3" wrap="wrap">
        <Box flexGrow="1" minWidth="200px">
          <Flex align="baseline" gap="2">
            <Text size="md" weight="semibold">
              {label}
            </Text>
            {envIsAuthoritative ? (
              <Text size="sm" color="text-mid">
                From environment
              </Text>
            ) : inactiveForPlan ? (
              <Badge label="Inactive" color="amber" />
            ) : managedByGrowthBook ? (
              <Text size="sm" color="text-mid">
                GrowthBook managed
              </Text>
            ) : null}
          </Flex>
          <Text size="sm" color="text-mid" as="div">
            {credential && !envIsAuthoritative ? (
              <>
                Key ending in <code>{credential.last4 || "••••"}</code>
                {credential.updatedByEmail
                  ? ` · set by ${credential.updatedByEmail}`
                  : ""}{" "}
                on {date(credential.dateUpdated)}
              </>
            ) : managedByGrowthBook ? (
              <>
                Using GrowthBook&apos;s managed key. Add your own to bill your
                provider account directly.
              </>
            ) : inheritedFromEnv ? (
              <>
                Using the <code>{envVar}</code> environment variable.
              </>
            ) : (
              <>
                No key configured.{" "}
                <Link href={consoleUrl} target="_blank" rel="noreferrer">
                  Create one
                </Link>
                .
              </>
            )}
          </Text>
        </Box>
        {canEdit &&
          !editing &&
          !envIsAuthoritative &&
          (canUseOwnKeys || credential) && (
            <Flex gap="2">
              {canUseOwnKeys && aiEnabled && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  {credential ? "Replace" : "Add key"}
                </Button>
              )}
              {credential && (
                <Button
                  variant="ghost"
                  color="red"
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove
                </Button>
              )}
            </Flex>
          )}
      </Flex>

      {inactiveForPlan && (
        <Box mt="2">
          <Callout status="warning">
            This key is not in use — your plan no longer includes your own
            provider keys.{" "}
            {isCloud()
              ? "AI features run on GrowthBook's managed keys."
              : `AI features use ${envVar} if it is set.`}
          </Callout>
        </Box>
      )}

      {editing && (
        <Box mt="3">
          <Field
            type="password"
            autoComplete="off"
            size="md"
            placeholder={keyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helpText={`Verified against ${label} before saving. Stored encrypted — it is never shown again.`}
          />
          <Flex gap="2" mt="2">
            <Button
              onClick={save}
              disabled={!apiKey.trim() || saving}
              loading={saving}
            >
              Save key
            </Button>
            <Button
              variant="ghost"
              color="gray"
              onClick={() => {
                setEditing(false);
                setApiKey("");
                setError(null);
                onCancelAdd?.();
              }}
            >
              Cancel
            </Button>
          </Flex>
        </Box>
      )}

      {error && (
        <Box mt="2">
          <Callout status="error">{error}</Callout>
        </Box>
      )}
      {warning && (
        <Box mt="2">
          <Callout status="warning">{warning}</Callout>
        </Box>
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title={`Remove the ${label} API key?`}
          content={
            isCloud() ? (
              <>
                <Box>
                  {`${label}'s models will switch back to GrowthBook's, and usage will start counting toward your daily limit again.`}
                </Box>
                {affectedSettings.length > 0 && (
                  <Box mt="3">
                    {"We'll move these settings for you:"}
                    <Box asChild mt="1" mb="0">
                      <ul>
                        {affectedSettings.map((s) => (
                          <li key={s.key}>
                            {`${s.label} → ${getModelDisplayLabel(s.fallback)}`}
                          </li>
                        ))}
                      </ul>
                    </Box>
                  </Box>
                )}
                <Box mt="3">
                  {"Once deleted, the key can't be recovered, only replaced."}
                </Box>
              </>
            ) : (
              <>
                <Box>
                  {`${label}'s models will stop working for everyone until `}
                  <code>{envVar}</code>
                  {` is set or a new key is saved.`}
                </Box>
                <Box mt="3">
                  {"Once deleted, the key can't be recovered, only replaced."}
                </Box>
              </>
            )
          }
          yesText="Remove key"
          onConfirm={remove}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </Frame>
  );
}

export default function AIProviderKeys({
  access,
  showPermissionCallout = true,
  aiEnabled = true,
  onCleared,
}: {
  access: AIProviderAccess;
  showPermissionCallout?: boolean;
  aiEnabled?: boolean;
  onCleared?: (keys: AIModelSettingKey[]) => void;
}) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();

  const {
    credentials,
    envProviders,
    canUseOwnKeys,
    mutate,
    isLoading,
    error,
    loaded,
  } = access;
  const { refreshOrganization } = useUser();

  const configured = new Set(credentials.map((c) => c.provider));
  const [addingProvider, setAddingProvider] = useState<AIProvider | "">("");

  if (error) {
    return (
      <Box mb="6" width="100%">
        <Text size="lg" weight="semibold" as="div" mb="3">
          AI providers
        </Text>
        <Callout status="error">
          Could not load your AI provider keys. {error.message}
        </Callout>
      </Box>
    );
  }

  if (isLoading && !loaded) return null;

  // Show configured providers and the row currently being added.
  const visibleProviders = AI_PROVIDERS.filter(
    (p) =>
      configured.has(p) ||
      (!isCloud() && envProviders.includes(p)) ||
      p === addingProvider,
  );

  const providerOptions = AI_PROVIDERS.map((p) => ({
    provider: p,
    label: AI_PROVIDER_META[p].label,
    disabled: visibleProviders.includes(p),
  })).sort(
    (a, b) =>
      Number(a.disabled) - Number(b.disabled) || a.label.localeCompare(b.label),
  );

  const showProviderPicker = providerOptions.some((o) => !o.disabled);
  let providerDescription: React.ReactNode;
  if (!canUseOwnKeys) {
    providerDescription = isCloud()
      ? "AI features run on GrowthBook's managed keys, under a daily usage limit."
      : "AI features use the keys set by this deployment's environment variables. A provider configured that way is managed where that variable is set.";
  } else if (!aiEnabled) {
    providerDescription =
      "Enable AI features above to add or replace a provider key. Existing keys stay stored and encrypted at rest.";
  } else if (isCloud()) {
    providerDescription =
      "Bring your own provider account. AI features run on GrowthBook's managed keys by default — add your own key to bill your provider directly and choose your own models. Keys are encrypted at rest.";
  } else {
    providerDescription =
      "Bring your own provider account. Keys are encrypted at rest. You only need a key for the providers whose models you actually use. A provider set by an environment variable is managed where that variable is set.";
  }

  return (
    <Box mb="6" width="100%">
      <Text size="lg" weight="semibold" as="div">
        AI providers
      </Text>
      <Text size="md" color="text-mid" as="div" mb="3">
        {providerDescription}
      </Text>

      {visibleProviders.map((provider) => (
        <ProviderRow
          key={provider}
          provider={provider}
          credential={credentials.find((c) => c.provider === provider)}
          inheritedFromEnv={envProviders.includes(provider)}
          canEdit={canEdit}
          canUseOwnKeys={canUseOwnKeys}
          aiEnabled={aiEnabled}
          onCleared={onCleared}
          startEditing={provider === addingProvider}
          onCancelAdd={
            provider === addingProvider
              ? () => setAddingProvider("")
              : undefined
          }
          onChanged={async () => {
            setAddingProvider("");
            await Promise.all([mutate(), refreshOrganization()]);
          }}
        />
      ))}

      {canEdit && !canUseOwnKeys && (
        <PremiumCallout commercialFeature="ai-byok" id="ai-provider-keys">
          {isCloud()
            ? "Bill your provider directly, pick your own models, and skip the daily usage limit."
            : "Add keys from this page instead of environment variables."}
        </PremiumCallout>
      )}

      {canEdit && canUseOwnKeys && aiEnabled && showProviderPicker && (
        <Box mt="3">
          <DropdownMenu
            trigger={
              <Button variant="solid" icon={<PiPlusBold />}>
                New provider
              </Button>
            }
          >
            {providerOptions.map(({ provider, label, disabled }) => (
              <DropdownMenuItem
                key={provider}
                disabled={disabled}
                tooltip={disabled ? "Already listed above" : undefined}
                onClick={() => setAddingProvider(provider)}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </Box>
      )}

      {!canEdit && showPermissionCallout && (
        <Callout status="info">
          You need permission to manage organization settings to change AI
          provider keys.
        </Callout>
      )}
    </Box>
  );
}
