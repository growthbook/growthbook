import { Flex } from "@radix-ui/themes";
import { ago } from "shared/dates";
import Text from "@/ui/Text";
import { capitalizeFirstLetter } from "@/services/utils";
import { AppNotice } from "./notices";
import { ExpiringKey, useExpiringKeysInput } from "./prototypeNotices";

// PROTOTYPE: on main, shared/api-key-expiration's, which this branch
// predates.
const isExpired = (expiresAt: Date | null | undefined) =>
  !!expiresAt && new Date(expiresAt).getTime() <= Date.now();

// The viewer's own personal access tokens, and for API key managers the
// organization's keys, that lapse soon or lapsed but are still in use. Expiry
// events go only to org webhooks, so this is how people hear about them.
export default function useKeyExpiryNotices(): AppNotice[] {
  // PROTOTYPE (set in review): the prototype panel's fakes
  // (prototypeNotices.ts); this branch predates the real ones. On main:
  // useUser()'s expiringPersonalAccessTokens and expiringApiKeys.
  const {
    personalAccessTokens: expiringPersonalAccessTokens,
    apiKeys: expiringApiKeys,
  } = useExpiringKeysInput();
  return [
    expiryNotice(expiringPersonalAccessTokens, {
      id: "personal-access-token-expiry",
      noun: "personal access token",
      href: "/account/personal-access-tokens",
      fix: "on your Personal Access Tokens page",
    }),
    expiryNotice(expiringApiKeys, {
      id: "api-key-expiry",
      noun: "API key",
      href: "/settings/keys",
      fix: "on the API Keys page",
    }),
  ].filter((notice): notice is AppNotice => !!notice);
}

function expiryNotice(
  keys: ExpiringKey[],
  {
    id,
    noun,
    href,
    fix,
  }: { id: string; noun: string; href: string; fix: string },
): AppNotice | null {
  if (!keys.length) return null;
  const expiredCount = keys.filter((k) => isExpired(k.expiresAt)).length;
  const severe = expiredCount > 0;
  // The title names the worst state, so it counts only keys in it
  const count = severe ? expiredCount : keys.length;
  const state = severe ? "expired" : "expiring";
  return {
    id,
    severity: severe ? "error" : "warning",
    title:
      count === 1
        ? `${capitalizeFirstLetter(state)} ${noun}`
        : `${count} ${state} ${noun}s`,
    href,
    details: (
      <Flex direction="column" gap="2">
        {keys.map((k) => (
          <Text as="div" size="inherit" key={k.id}>
            <strong>{k.description || k.id}</strong>{" "}
            {isExpired(k.expiresAt)
              ? `expired ${ago(k.expiresAt as Date)} but was used ${ago(k.lastUsed as Date)}.`
              : `expires ${ago(k.expiresAt as Date)}.`}
          </Text>
        ))}
        <Text as="div" size="inherit">
          To replace one, use <strong>Copy settings to new key</strong> {fix}.
        </Text>
      </Flex>
    ),
  };
}
