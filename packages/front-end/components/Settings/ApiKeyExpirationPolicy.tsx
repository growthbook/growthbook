import { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  maxExpirationDate,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { date } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { hasFileConfig } from "@/services/env";
import TextField from "@/ui/TextField";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

type Kind = "pat" | "secret";

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

const FILE_CONFIG_REASON =
  "Organization settings are managed by your config.yml file";

const settingField = (kind: Kind) =>
  kind === "pat" ? "maxPatLifetimeDays" : "maxApiKeyLifetimeDays";

const countKeys = (count: number, kind: Kind) =>
  `${count} ${count === 1 ? COPY[kind].noun : COPY[kind].nounPlural}`;

const ExpirationPolicyModal: FC<{
  kind: Kind;
  saved: number | null;
  close: () => void;
}> = ({ kind, saved, close }) => {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  // Turning the policy on is what opens this, so a blank one starts at 90 days.
  const [draft, setDraft] = useState(String(saved ?? 90));

  const maxDays = Number(draft.trim());
  const invalid = !Number.isInteger(maxDays) || maxDays < 1;

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
      }}
    >
      <TextField
        inputMode="numeric"
        label="Maximum lifetime (days)"
        helpText={`How long a newly created ${COPY[kind].noun} can last.`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        error={
          invalid ? "Enter a whole number of days, at least 1." : undefined
        }
        disabled={hasFileConfig()}
      />
    </ModalStandard>
  );
};

/**
 * One Checkbox row in an "Organization Policies" card. The two kinds stay
 * separate because a lapsed personal access token inconveniences one member
 * while a lapsed secret key takes down an integration.
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
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = settings?.[settingField(kind)] ?? null;

  if (!canManage) return null;

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

  // Loosening needs no confirmation, like unchecking the sibling kill switch.
  const clear = async () => {
    setError(null);
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({ settings: { [settingField(kind)]: null } }),
      });
      await refreshOrganization();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <Checkbox
        label={`Require ${COPY[kind].nounPlural} to expire`}
        value={saved !== null}
        disabled={locked}
        disabledMessage={FILE_CONFIG_REASON}
        setValue={(value) => (value ? setEditing(true) : void clear())}
        description={
          saved === null ? (
            `New ${COPY[kind].short} can be created without an expiration date.`
          ) : (
            <Flex align="center" gap="2" wrap="wrap" asChild>
              <span>
                {`New ${COPY[kind].short} must expire within ${saved} day${saved === 1 ? "" : "s"}.`}
                {!locked && (
                  <Link
                    onClick={(e) => {
                      // Inside the Checkbox's label, so a click would also toggle it off.
                      e.preventDefault();
                      setEditing(true);
                    }}
                  >
                    Change
                  </Link>
                )}
                {nonCompliant.length > 0 && (
                  <Tooltip
                    content={`${countKeys(nonCompliant.length, kind)} have no expiration date or expire later than the maximum, marked in the Expires column.${locked ? "" : " Click to apply the limit to them."}`}
                  >
                    {locked ? (
                      <span>{badge}</span>
                    ) : (
                      <Link
                        onClick={(e) => {
                          e.preventDefault();
                          setApplying(true);
                        }}
                      >
                        {badge}
                      </Link>
                    )}
                  </Tooltip>
                )}
              </span>
            </Flex>
          )
        }
        error={error ?? undefined}
      />

      {editing && (
        <ExpirationPolicyModal
          kind={kind}
          saved={saved}
          close={() => setEditing(false)}
        />
      )}
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
