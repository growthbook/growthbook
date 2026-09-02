import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { violatesExpirationPolicy } from "shared/api-key-expiration";
import { datetime } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";

type Kind = "pat" | "secret";

const COPY: Record<Kind, { noun: string; nounPlural: string }> = {
  pat: { noun: "personal access token", nounPlural: "personal access tokens" },
  secret: { noun: "secret API key", nounPlural: "secret API keys" },
};

/**
 * Policy control for one key kind, rendered beside that kind's table. The two
 * kinds stay separate because a lapsed personal access token inconveniences one
 * member while a lapsed secret key takes down an integration.
 */
const ApiKeyExpirationPolicy: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ kind, keys, mutate }) => {
  const { apiCall } = useAuth();
  const { settings, refreshOrganization } = useUser();
  // Stamping dates onto other people's tokens is key management, not general
  // org configuration, so this is gated tighter than the page around it.
  const canManage = usePermissionsUtil().canDeleteApiKey();

  const field = kind === "pat" ? "maxPatLifetimeDays" : "maxApiKeyLifetimeDays";
  const saved = settings?.[field] ?? null;

  const [draft, setDraft] = useState<string>(
    saved === null ? "" : String(saved),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  if (!canManage) return null;

  const nonCompliant = keys.filter((k) =>
    violatesExpirationPolicy(k.expiresAt, saved),
  );

  const save = async () => {
    setError(null);
    const trimmed = draft.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      setError("Enter a whole number of days, at least 1, or leave it empty.");
      return;
    }
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({ settings: { [field]: value } }),
      });
      await refreshOrganization();
    } catch (e) {
      setError(e.message);
    }
  };

  const applyToExisting = async () => {
    setError(null);
    try {
      const res = await apiCall<{ updated: number; expiresAt: string | null }>(
        "/keys/apply-expiration-policy",
        { method: "POST", body: JSON.stringify({ kind }) },
      );
      setApplied(
        `${res.updated} ${res.updated === 1 ? COPY[kind].noun : COPY[kind].nounPlural} now expire on ${
          res.expiresAt ? datetime(res.expiresAt) : "the policy maximum"
        }.`,
      );
      mutate();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="1">
        Expiration Policy
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        {`Set the longest lifetime a new ${COPY[kind].noun} can be given. Leave it empty to make expiration optional.`}
        {/* Said here rather than on the field, which sits in a bottom-aligned
            row that a help message underneath would knock out of line. */}
        {hasFileConfig() &&
          " Organization settings are managed by your config.yml file."}
      </Text>

      <Flex align="end" gap="3" mb="3">
        <TextField
          type="number"
          label="Maximum lifetime (days)"
          placeholder="No maximum"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={hasFileConfig()}
        />
        <Button onClick={save} disabled={hasFileConfig()}>
          Save
        </Button>
      </Flex>

      {saved !== null && nonCompliant.length > 0 && (
        <Callout
          status="warning"
          mb="3"
          action={
            <Button color="red" onClick={() => setConfirming(true)}>
              Apply to existing
            </Button>
          }
        >
          {`${nonCompliant.length} existing ${
            nonCompliant.length === 1 ? COPY[kind].noun : COPY[kind].nounPlural
          } have no expiration date or expire later than the maximum. New ones follow the policy already.`}
        </Callout>
      )}

      {applied && (
        <Callout status="success" mb="3">
          {applied}
        </Callout>
      )}
      {error && <Callout status="error">{error}</Callout>}

      {confirming && (
        <ConfirmDialog
          title={`Apply expiration to ${nonCompliant.length} existing ${
            nonCompliant.length === 1 ? COPY[kind].noun : COPY[kind].nounPlural
          }?`}
          content={`They will stop working on the new expiration date unless they are replaced first. This can't be undone by clearing the policy afterwards.`}
          yesText="Apply to existing"
          color="red"
          onConfirm={async () => {
            await applyToExisting();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Frame>
  );
};

export default ApiKeyExpirationPolicy;
