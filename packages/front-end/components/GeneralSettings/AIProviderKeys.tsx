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
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

type AICredentialsResponse = {
  credentials: AICredentialFrontEndInterface[];
  envProviders: AIProvider[];
  canUseOwnKeys: boolean;
};

// Read model for /ai/credentials. Exported so other settings UI can warn about
// a model whose provider has no key without re-deriving the precedence rules.
export function useAIProviderKeys() {
  const { data, error, mutate, isLoading } =
    useApi<AICredentialsResponse>("/ai/credentials");

  const credentials = data?.credentials ?? [];
  const envProviders = data?.envProviders ?? [];
  // The back end's ai-byok gate, not re-derived here. A failed request leaves it
  // false, which is not "the plan doesn't include it" — check `error` first.
  const canUseOwnKeys = !!data?.canUseOwnKeys;

  // A key the org stored itself. On Cloud the env keys are GrowthBook's, so this
  // is the set the org pays for. Gated on canUseOwnKeys because the resolver is.
  const hasOwnKeyForProvider = (provider: AIProvider): boolean =>
    canUseOwnKeys && credentials.some((c) => c.provider === provider);

  const hasKeyForProvider = (provider: AIProvider): boolean =>
    hasOwnKeyForProvider(provider) || envProviders.includes(provider);

  const hasKeyForModel = (model: AIModel | string): boolean => {
    try {
      return hasKeyForProvider(getProviderFromModel(model as AIModel));
    } catch {
      return false;
    }
  };

  // Paying its own provider bill. On Cloud this unlocks model selection.
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
    // Exported so the settings page and the pickers can't disagree.
    canChooseModels: !isCloud() || hasOwnKey,
    // Cloud counts stored keys only; counting the managed env keys would let one
    // stored Anthropic key unlock the OpenAI and Google lists too.
    selectableProviders: data
      ? AI_PROVIDERS.filter((p) =>
          isCloud() ? hasOwnKeyForProvider(p) : hasKeyForProvider(p),
        )
      : undefined,
    mutate,
    isLoading,
    error,
    // Separates "still loading" from "loaded, and there is no key", so callers
    // don't flash a warning on first paint.
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
  startEditing = false,
  onCancelAdd,
  onChanged,
}: {
  provider: AIProvider;
  credential?: AICredentialFrontEndInterface;
  inheritedFromEnv: boolean;
  canEdit: boolean;
  // Separate from canEdit: a downgraded org can still remove a leftover key.
  canUseOwnKeys: boolean;
  // Open the input immediately, for the provider just picked from the dropdown.
  startEditing?: boolean;
  // Set only while the row exists because of that pick, so cancelling can take
  // the tile with it instead of leaving an empty "Add key" row behind.
  onCancelAdd?: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const { label, keyPlaceholder, consoleUrl, envVar } =
    AI_PROVIDER_META[provider];

  // Self-hosted, the env var wins and the row is read-only. Cloud must be
  // exempt: its env rows are GrowthBook's managed keys, so applying the rule
  // there would leave no way to BYOK at all.
  const envIsAuthoritative = inheritedFromEnv && !isCloud();

  // Same `env` source, different thing to say: the admin never set this one and
  // can't go change it, so adding their own on top is the supported move.
  const managedByGrowthBook = inheritedFromEnv && isCloud() && !credential;

  // A stored key the plan no longer covers, so the resolver ignores it.
  const inactiveForPlan = !!credential && !canUseOwnKeys;

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

  // Not try/caught on purpose: ConfirmDialog renders the rejection itself, so
  // the failure stays next to the action instead of also hitting the row.
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
            {envIsAuthoritative ? (
              <Text size="sm" color="text-mid">
                From environment
              </Text>
            ) : inactiveForPlan ? (
              /* A Badge, not muted text like the source labels beside it. */
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
              {/* Remove stays available without the plan feature; adding doesn't. */}
              {canUseOwnKeys && (
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

      {/* Its own Callout: appending it to the key metadata buried it. */}
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

// Per-org AI provider API keys. On Cloud a key here outranks GrowthBook's
// managed key; self-hosted the host's env vars win and show as read-only.
export default function AIProviderKeys({
  access,
  // AI Settings renders its own callout covering this section, so it opts out
  // rather than banner the same gap twice.
  showPermissionCallout = true,
}: {
  access: AIProviderAccess;
  showPermissionCallout?: boolean;
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

  // The row just opened from the "New provider" menu, so the common case is one
  // pick plus one paste. The menu itself keeps no selection.
  const configured = new Set(credentials.map((c) => c.provider));
  const [addingProvider, setAddingProvider] = useState<AIProvider | "">("");

  // A failed load is not a downgrade: `canUseOwnKeys` is false and `credentials`
  // empty either way, so without this the section renders the upgrade callout.
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

  // Only providers already set up, plus the one being added — listing all five
  // is a wall of empty rows. Env rows count only self-hosted; on Cloud every
  // managed provider reports as `env`, which would list all five for every org.
  const visibleProviders = AI_PROVIDERS.filter(
    (p) =>
      configured.has(p) ||
      (!isCloud() && envProviders.includes(p)) ||
      p === addingProvider,
  );

  // Every provider stays in the menu for discoverability, but one that already
  // has a row is disabled and sorted last — its row is where you replace it.
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
      {/* Don't pitch a key the plan won't allow; the callout below upsells. */}
      <Text size="md" color="text-mid" as="div" mb="3">
        {!canUseOwnKeys ? (
          isCloud() ? (
            <>
              AI features run on GrowthBook&apos;s managed keys, under a daily
              usage limit.
            </>
          ) : (
            <>
              AI features use the keys set by this deployment&apos;s environment
              variables. A provider configured that way is managed where that
              variable is set.
            </>
          )
        ) : isCloud() ? (
          <>
            Bring your own provider account. AI features run on
            GrowthBook&apos;s managed keys by default — add your own key to bill
            your provider directly and choose your own models. Keys are
            encrypted at rest.
          </>
        ) : (
          <>
            Bring your own provider account. Keys are encrypted at rest. You
            only need a key for the providers whose models you actually use. A
            provider set by an environment variable is managed where that
            variable is set.
          </>
        )}
      </Text>

      {visibleProviders.map((provider) => (
        <ProviderRow
          key={provider}
          provider={provider}
          credential={credentials.find((c) => c.provider === provider)}
          inheritedFromEnv={envProviders.includes(provider)}
          canEdit={canEdit}
          canUseOwnKeys={canUseOwnKeys}
          startEditing={provider === addingProvider}
          onCancelAdd={
            provider === addingProvider
              ? () => setAddingProvider("")
              : undefined
          }
          onChanged={async () => {
            // Let the row be driven by the saved credential from here on.
            setAddingProvider("");
            // Both caches: this section reads /ai/credentials, but AI gating
            // app-wide reads `aiKeyProviders` off /organization. Refreshing only
            // the first leaves every other AI control stale.
            await Promise.all([mutate(), refreshOrganization()]);
          }}
        />
      ))}

      {canEdit && !canUseOwnKeys && (
        <Callout status="info">
          <PremiumTooltip commercialFeature="ai-byok">
            Using your own AI provider keys
          </PremiumTooltip>{" "}
          {isCloud()
            ? "requires an Enterprise plan. AI features still work on GrowthBook's managed keys."
            : "requires an Enterprise plan."}
        </Callout>
      )}

      {canEdit && canUseOwnKeys && showProviderPicker && (
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
