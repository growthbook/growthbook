import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import AIProviderLogo from "./AIProviderLogo";

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

  const remove = async () => {
    setError(null);
    setWarning(null);
    try {
      await apiCall(`/ai/credentials/${provider}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Box
      mb="3"
      p="3"
      style={{
        border: "1px solid var(--slate-a4)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Flex align="center" gap="3" wrap="wrap">
        <AIProviderLogo provider={provider} />
        <Box style={{ flexGrow: 1, minWidth: 200 }}>
          <Flex align="center" gap="2">
            <Text size="medium" weight="semibold">
              {label}
            </Text>
            {credential ? (
              <Badge label="Configured" color="green" />
            ) : inheritedFromEnv ? (
              <Badge label="From environment" color="blue" />
            ) : null}
          </Flex>
          <Text size="small" color="text-mid" as="div">
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
                Using the <code>{envVar}</code> environment variable. A key
                saved here overrides it.
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
        {canEdit && !editing && (
          <Flex gap="2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {credential ? "Replace" : "Add key"}
            </Button>
            {credential && (
              <Button variant="ghost" color="red" onClick={remove}>
                Remove
              </Button>
            )}
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
    </Box>
  );
}

/**
 * Per-org AI provider API keys. Rendered under the "Enable AI features" toggle
 * on both Cloud and self-hosted: a key stored here always wins over the host's
 * environment variables, which is how an org brings its own provider account.
 */
export default function AIProviderKeys() {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();

  const { credentials, envProviders, mutate, isLoading, loaded } =
    useAIProviderKeys();

  // Which provider's key the "Add a provider" picker is scoped to. Defaults to
  // the first provider with nothing configured, so the common case — one org,
  // one provider — is a single dropdown plus one paste.
  const configured = new Set(credentials.map((c) => c.provider));
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | "">("");

  if (isLoading && !loaded) return null;

  // Show a row for every provider that is already set up somehow, plus the one
  // the admin is actively adding. Listing all five unconditionally turns a
  // simple setting into a wall of empty rows.
  const visibleProviders = AI_PROVIDERS.filter(
    (p) =>
      configured.has(p) || envProviders.includes(p) || p === selectedProvider,
  );

  const addableProviders = AI_PROVIDERS.filter((p) => !configured.has(p));

  return (
    <Box mb="6" width="100%">
      <Text size="large" weight="semibold" as="div">
        AI providers
      </Text>
      <Text size="medium" color="text-mid" as="div" mb="3">
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
          startEditing={provider === selectedProvider}
          onChanged={async () => {
            // Clear the picker so the row is driven by the saved credential
            // from here on, and the dropdown offers the remaining providers.
            setSelectedProvider("");
            await mutate();
          }}
        />
      ))}

      {canEdit && addableProviders.length > 0 && (
        <Box mt="3" style={{ maxWidth: 320 }}>
          <SelectField
            label="Add a provider"
            size="medium"
            value={selectedProvider}
            onChange={(v) => setSelectedProvider(v as AIProvider)}
            initialOption="Select a provider..."
            options={addableProviders.map((p) => ({
              value: p,
              label: AI_PROVIDER_META[p].label,
            }))}
          />
        </Box>
      )}

      {!canEdit && (
        <Callout status="info">
          You need permission to manage organization settings to change AI
          provider keys.
        </Callout>
      )}
    </Box>
  );
}
