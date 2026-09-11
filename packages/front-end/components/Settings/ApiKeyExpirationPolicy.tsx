import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { violatesExpirationPolicy } from "shared/api-key-expiration";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

type Kind = "pat" | "secret";

const COPY: Record<
  Kind,
  { noun: string; nounPlural: string; subject: string; short: string }
> = {
  pat: {
    noun: "personal access token",
    nounPlural: "personal access tokens",
    subject: "Tokens",
    short: "tokens",
  },
  secret: {
    noun: "secret API key",
    nounPlural: "secret API keys",
    subject: "Keys",
    short: "keys",
  },
};

const FILE_CONFIG_REASON =
  "Organization settings are managed by your config.yml file";

const settingField = (kind: Kind) =>
  kind === "pat" ? "maxPatLifetimeDays" : "maxApiKeyLifetimeDays";

const countKeys = (count: number, kind: Kind) =>
  `${count} ${count === 1 ? COPY[kind].noun : COPY[kind].nounPlural}`;

const ExpirationPolicyModal: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  saved: number | null;
  close: () => void;
  mutate: () => void;
}> = ({ kind, keys, saved, close, mutate }) => {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const [draft, setDraft] = useState(saved === null ? "" : String(saved));
  const [applyToExisting, setApplyToExisting] = useState(false);

  const trimmed = draft.trim();
  const maxDays = trimmed === "" ? null : Number(trimmed);
  const invalid =
    maxDays !== null && (!Number.isInteger(maxDays) || maxDays < 1);

  // Counted against the draft rather than the saved policy, so the impact of a
  // number updates as it is typed.
  const nonCompliant = invalid
    ? []
    : keys.filter((k) => violatesExpirationPolicy(k.expiresAt, maxDays));

  return (
    <ModalStandard
      open
      trackingEventModalType=""
      header="Expiration Policy"
      close={close}
      cta="Save"
      ctaEnabled={!invalid}
      submit={async () => {
        await apiCall("/organization", {
          method: "PUT",
          body: JSON.stringify({ settings: { [settingField(kind)]: maxDays } }),
        });
        await refreshOrganization();
        // After the save, so the backfill stamps the policy just set.
        if (applyToExisting && nonCompliant.length) {
          await apiCall("/keys/apply-expiration-policy", {
            method: "POST",
            body: JSON.stringify({ kind }),
          });
        }
        mutate();
      }}
    >
      <TextField
        inputMode="numeric"
        label="Maximum lifetime (days)"
        placeholder="No maximum"
        helpText={`How long a newly created ${COPY[kind].noun} can last. Leave it empty to make expiration optional.`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        error={
          invalid
            ? "Enter a whole number of days, at least 1, or leave it empty."
            : undefined
        }
        disabled={hasFileConfig()}
      />

      {nonCompliant.length > 0 && (
        <Callout status="warning" mt="4">
          {/* One prose block, then the control — a checkbox between paragraphs
              leaves its label indented against text on both sides. */}
          {`${countKeys(nonCompliant.length, kind)} have no expiration date or expire later than this maximum. New ones follow the policy already. Updating them now stops them working on the new date unless they are replaced first, and clearing the policy later won't undo it.`}
          <Box mt="3">
            <Checkbox
              weight="regular"
              value={applyToExisting}
              setValue={setApplyToExisting}
              label={`Apply this maximum lifetime to non-compliant ${COPY[kind].short}`}
            />
          </Box>
        </Callout>
      )}
    </ModalStandard>
  );
};

/**
 * Policy summary for one key kind, rendered above that kind's table. The two
 * kinds stay separate because a lapsed personal access token inconveniences one
 * member while a lapsed secret key takes down an integration.
 */
const ApiKeyExpirationPolicy: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ kind, keys, mutate }) => {
  const { settings } = useUser();
  // Stamping dates onto other people's tokens is key management, not general
  // org configuration, so this is gated tighter than the page around it.
  const canManage = usePermissionsUtil().canDeleteApiKey();
  const [editing, setEditing] = useState(false);

  const saved = settings?.[settingField(kind)] ?? null;

  if (!canManage) return null;

  const nonCompliant = keys.filter((k) =>
    violatesExpirationPolicy(k.expiresAt, saved),
  );
  const nonCompliantReason = `${countKeys(nonCompliant.length, kind)} have no expiration date or expire later than the maximum.`;
  const locked = hasFileConfig();

  return (
    <>
      <Frame mb="4" py="3" px="4">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="2" wrap="wrap">
            <Text weight="medium">Expiration Policy:</Text>
            <Text color="text-mid">
              {saved === null
                ? `${COPY[kind].subject} last indefinitely`
                : `${COPY[kind].subject} last up to ${saved} day${saved === 1 ? "" : "s"}`}
            </Text>
            {nonCompliant.length > 0 &&
              // The count is the reason to open the modal, so it opens it.
              (locked ? (
                <Badge
                  color="amber"
                  variant="soft"
                  label={`${nonCompliant.length} non-compliant`}
                  title={nonCompliantReason}
                />
              ) : (
                <Link
                  onClick={() => setEditing(true)}
                  title={nonCompliantReason}
                >
                  <Badge
                    color="amber"
                    variant="soft"
                    label={`${nonCompliant.length} non-compliant`}
                    style={{ cursor: "pointer" }}
                  />
                </Link>
              ))}
          </Flex>
          <Button
            variant="outline"
            disabled={locked}
            title={locked ? FILE_CONFIG_REASON : undefined}
            onClick={() => setEditing(true)}
          >
            {saved === null ? "Set expiration" : "Edit expiration"}
          </Button>
        </Flex>
      </Frame>

      {editing && (
        <ExpirationPolicyModal
          kind={kind}
          keys={keys}
          saved={saved}
          mutate={mutate}
          close={() => setEditing(false)}
        />
      )}
    </>
  );
};

export default ApiKeyExpirationPolicy;
