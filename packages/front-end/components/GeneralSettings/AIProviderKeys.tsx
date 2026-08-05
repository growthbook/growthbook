import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlusBold } from "react-icons/pi";
import {
  AIProvider,
  AI_PROVIDERS,
  AI_PROVIDER_META,
  getProviderFromModel,
  AIModel,
} from "shared/ai";
import { AICredentialFrontEndInterface } from "shared/validators";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

type AICredentialsResponse = {
  credentials: AICredentialFrontEndInterface[];
  envProviders: AIProvider[];
};

/**
 * Read model for the AI credentials endpoint. Exported so other settings UI can
 * warn about a model whose provider has no key, without each caller
 * re-deriving the env-var-vs-stored-key precedence.
 */
export function useAIProviderKeys() {
  const { data, mutate, isLoading } =
    useApi<AICredentialsResponse>("/ai/credentials");

  const credentials = data?.credentials ?? [];
  const envProviders = data?.envProviders ?? [];

  const hasKeyForProvider = (provider: AIProvider): boolean =>
    credentials.some((c) => c.provider === provider) ||
    envProviders.includes(provider);

  const hasKeyForModel = (model: AIModel | string): boolean => {
    try {
      return hasKeyForProvider(getProviderFromModel(model as AIModel));
    } catch {
      return false;
    }
  };

  return {
    credentials,
    envProviders,
    hasKeyForProvider,
    hasKeyForModel,
    hasAnyKey: AI_PROVIDERS.some(hasKeyForProvider),
    // The org stores at least one key of its own, so it is paying its own
    // provider bill. On Cloud that unlocks model selection, which is otherwise
    // pinned to the managed default.
    hasOwnKey: credentials.length > 0,
    mutate,
    isLoading,
    // Distinguishes "still loading" from "loaded, and there really is no key",
    // so callers don't flash a scary warning on first paint.
    loaded: !!data,
  };
}

function ProviderRow({
  provider,
  credential,
  inheritedFromEnv,
  canEdit,
  startEditing = false,
  onChanged,
}: {
  provider: AIProvider;
  credential?: AICredentialFrontEndInterface;
  inheritedFromEnv: boolean;
  canEdit: boolean;
  // Open the key input immediately. Set for the provider the admin just picked
  // from the "Add a provider" dropdown, so choosing one lands them on the input
  // instead of an extra "Add key" click.
  startEditing?: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const { label, keyPlaceholder, consoleUrl, envVar } =
    AI_PROVIDER_META[provider];

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
      // The key was stored, but we couldn't confirm it with the provider.
      if (res?.warning) setWarning(res.warning);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Deliberately not try/caught: ConfirmDialog's confirm button awaits this and
  // renders a rejection inside the dialog, so a failure stays next to the action
  // that caused it instead of also painting the row's callout behind it.
  const remove = async () => {
    setError(null);
    setWarning(null);
    await apiCall(`/ai/credentials/${provider}`, { method: "DELETE" });
    setConfirmingRemove(false);
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
            {inheritedFromEnv ? (
              <Text size="sm" color="text-mid">
                From environment readonly
              </Text>
            ) : null}
          </Flex>
          <Text size="sm" color="text-mid" as="div">
            {credential ? (
              <>
                Key ending in <code>{credential.last4 || "••••"}</code>
                {credential.updatedByEmail
                  ? ` · set by ${credential.updatedByEmail}`
                  : ""}{" "}
                on {date(credential.dateUpdated)}
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
        {canEdit && !editing && credential && (
          <Flex gap="2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button
              variant="ghost"
              color="red"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          </Flex>
        )}
      </Flex>

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
            <>
              The key cannot be recovered, only replaced.{" "}
              {isCloud() ? (
                <>
                  {label} models fall back to GrowthBook&apos;s managed key, and
                  usage counts against your daily limit again.
                </>
              ) : (
                <>
                  {label} models stop working for everyone until{" "}
                  <code>{envVar}</code> is set or a new key is saved.
                </>
              )}
            </>
          }
          yesText="Remove key"
          onConfirm={remove}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </Frame>
  );
}

/**
 * Per-org AI provider API keys. Rendered under the "Enable AI features" toggle
 * on both Cloud and self-hosted: a key stored here always wins over the host's
 * environment variables, which is how an org brings its own provider account.
 */
export default function AIProviderKeys({
  // The AI Settings page renders its own permission callout covering this
  // section and everything above it, so it opts out of this one rather than
  // banner the same gap twice. Defaults to showing it, so the component stays
  // self-explanatory anywhere else it's mounted.
  showPermissionCallout = true,
}: {
  showPermissionCallout?: boolean;
} = {}) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();

  const { credentials, envProviders, mutate, isLoading, loaded } =
    useAIProviderKeys();
  const { refreshOrganization } = useUser();

  // The provider whose row the admin just opened from the "Add a new provider"
  // menu, so the common case — one org, one provider — is one pick plus one
  // paste. The menu itself keeps no selection: it closes on pick and the row it
  // opened is the only state that matters.
  const configured = new Set(credentials.map((c) => c.provider));
  const [addingProvider, setAddingProvider] = useState<AIProvider | "">("");

  if (isLoading && !loaded) return null;

  // Show a row for every provider that is already set up somehow, plus the one
  // the admin is actively adding. Listing all five unconditionally turns a
  // simple setting into a wall of empty rows.
  const visibleProviders = AI_PROVIDERS.filter(
    (p) =>
      configured.has(p) || envProviders.includes(p) || p === addingProvider,
  );

  // Every provider stays in the menu so the full set is discoverable, but one
  // that already has a row above can't be added twice: it's disabled and sorted
  // below the ones that are still addable. Its row is where you replace or
  // override its key. This includes the provider just picked from here — the row
  // appears immediately, so picking it again would do nothing.
  const providerOptions = AI_PROVIDERS.map((p) => ({
    provider: p,
    label: AI_PROVIDER_META[p].label,
    disabled: visibleProviders.includes(p),
  })).sort(
    (a, b) =>
      Number(a.disabled) - Number(b.disabled) || a.label.localeCompare(b.label),
  );

  // Every provider has a row — the menu would be nothing but dead entries.
  const showProviderPicker = providerOptions.some((o) => !o.disabled);

  return (
    <Box mb="6" width="100%">
      <Text size="lg" weight="semibold" as="div">
        AI providers
      </Text>
      <Text size="md" color="text-mid" as="div" mb="3">
        Bring your own provider account. Keys are encrypted at rest, and a key
        saved here takes precedence over any environment variable. You only need
        a key for the providers whose models you actually use.
      </Text>

      {visibleProviders.map((provider) => (
        <ProviderRow
          key={provider}
          provider={provider}
          credential={credentials.find((c) => c.provider === provider)}
          inheritedFromEnv={envProviders.includes(provider)}
          canEdit={canEdit}
          startEditing={provider === addingProvider}
          onChanged={async () => {
            // Let the row be driven by the saved credential from here on.
            setAddingProvider("");
            // Both caches: this section reads /ai/credentials, but AI gating
            // app-wide reads `aiKeyProviders` off the /organization payload.
            // Refreshing only the first leaves every other AI control stale —
            // still disabled after the first key is added, still enabled after
            // the last one is removed.
            await Promise.all([mutate(), refreshOrganization()]);
          }}
        />
      ))}

      {canEdit && showProviderPicker && (
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
                <Flex align="center" gap="2">
                  {label}
                </Flex>
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
