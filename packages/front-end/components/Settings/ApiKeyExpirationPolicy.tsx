import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  maxExpirationDate,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { date } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import TextField from "@/ui/TextField";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import Metadata from "@/ui/Metadata";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";

export type Kind = "pat" | "secret";

const COPY: Record<Kind, { noun: string; nounPlural: string; short: string }> =
  {
    pat: {
      noun: "personal access token",
      nounPlural: "personal access tokens",
      short: "tokens",
    },
    secret: {
      noun: "secret API key",
      nounPlural: "secret API keys",
      short: "keys",
    },
  };

export const settingField = (kind: Kind) =>
  kind === "pat" ? "maxPatLifetimeDays" : "maxApiKeyLifetimeDays";

const countKeys = (count: number, kind: Kind) =>
  `${count} ${count === 1 ? COPY[kind].noun : COPY[kind].nounPlural}`;

/** A draft of the policy: `null` is off, otherwise the typed day count. */
export function parseLifetimeDraft(draft: string | null) {
  if (draft === null) return { value: null, invalid: false };
  const value = Number(draft.trim());
  return { value, invalid: !Number.isInteger(value) || value < 1 };
}

/** The policy's control in an edit modal: a checkbox revealing the day count. */
export const ExpirationPolicyField: FC<{
  kind: Kind;
  draft: string | null;
  setDraft: (draft: string | null) => void;
}> = ({ kind, draft, setDraft }) => {
  const { invalid } = parseLifetimeDraft(draft);
  return (
    <>
      <Checkbox
        label={`Require ${COPY[kind].nounPlural} to expire`}
        description={`New ${COPY[kind].short} must have an expiration date within a maximum lifetime.`}
        value={draft !== null}
        setValue={(on) => setDraft(on ? "90" : null)}
      />
      {draft !== null && (
        // Indented past the checkbox and gap, under its description.
        <Box mt="3" style={{ paddingLeft: 24 }}>
          <TextField
            inputMode="numeric"
            label="Maximum lifetime (days)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            error={
              invalid ? "Enter a whole number of days, at least 1." : undefined
            }
          />
        </Box>
      )}
    </>
  );
};

/**
 * The policy's read-only row in an "Organization Policies" card, plus the one
 * action it carries: applying the limit to existing keys from the count.
 */
const ApiKeyExpirationPolicy: FC<{
  kind: Kind;
  keys: ApiKeyInterface[];
  mutate: () => void;
}> = ({ kind, keys, mutate }) => {
  const { apiCall } = useAuth();
  const { settings } = useUser();
  const [applying, setApplying] = useState(false);

  const saved = settings?.[settingField(kind)] ?? null;
  const nonCompliant = keys.filter((k) =>
    violatesExpirationPolicy(k.expiresAt, saved),
  );
  const locked = hasFileConfig();
  const badge = (
    <Badge
      color="amber"
      variant="soft"
      label={`${nonCompliant.length} non-compliant`}
      style={locked ? undefined : { cursor: "pointer" }}
    />
  );

  return (
    <>
      <Metadata
        label={`Require ${COPY[kind].nounPlural} to expire`}
        value={
          saved === null ? (
            "Off"
          ) : (
            <Flex align="center" gap="2">
              <Text color="text-mid">
                {`Within ${saved} day${saved === 1 ? "" : "s"}`}
              </Text>
              {nonCompliant.length > 0 && (
                <Tooltip
                  content={`${countKeys(nonCompliant.length, kind)} have no expiration date or expire later than the maximum, marked in the Expires column.${locked ? "" : " Click to apply the limit to them."}`}
                >
                  {locked ? (
                    <span>{badge}</span>
                  ) : (
                    <Link onClick={() => setApplying(true)}>{badge}</Link>
                  )}
                </Tooltip>
              )}
            </Flex>
          )
        }
      />
      {applying && saved !== null && (
        <ConfirmDialog
          title={`Apply the ${saved}-day limit to existing ${COPY[kind].short}?`}
          content={`${countKeys(nonCompliant.length, kind)} will expire on ${date(maxExpirationDate(saved) as Date)}. ${kind === "pat" ? "Their owners will need to replace them before then." : "Replace them, or edit their dates, before then to keep integrations working."}`}
          yesText="Set expiration dates"
          onConfirm={async () => {
            await apiCall("/keys/apply-expiration-policy", {
              method: "POST",
              body: JSON.stringify({ kind }),
            });
            mutate();
            setApplying(false);
          }}
          onCancel={() => setApplying(false)}
        />
      )}
    </>
  );
};

export default ApiKeyExpirationPolicy;
