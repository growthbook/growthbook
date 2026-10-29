import { Flex } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { isExpired } from "shared/api-key-expiration";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { capitalizeFirstLetter } from "@/services/utils";
import { AppNotice } from "./notices";

type ExpiringKey = ReturnType<typeof useUser>["expiringApiKeys"][number];

// The viewer's own personal access tokens, and for API key managers the
// organization's keys, that lapse soon or lapsed but are still in use. Expiry
// events go only to org webhooks, so this is how people hear about them.
export default function useKeyExpiryNotices(): AppNotice[] {
  const { expiringPersonalAccessTokens, expiringApiKeys, settings } = useUser();
  const canReplaceApiKeys = usePermissionsUtil().canCreateApiKey();
  return [
    // Disabled tokens fail at authentication whatever their expiry.
    expiryNotice(
      settings?.disablePersonalAccessTokens ? [] : expiringPersonalAccessTokens,
      {
        id: "personal-access-token-expiry",
        noun: "personal access token",
        href: "/account/personal-access-tokens",
        fix: "on your Personal Access Tokens page",
        canReplace: true,
      },
    ),
    expiryNotice(expiringApiKeys, {
      id: "api-key-expiry",
      noun: "API key",
      href: "/settings/keys",
      fix: "on the API Keys page",
      canReplace: canReplaceApiKeys,
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
    canReplace,
  }: {
    id: string;
    noun: string;
    href: string;
    fix: string;
    canReplace: boolean;
  },
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
          {canReplace ? (
            <>
              To replace one, use <strong>Copy settings to new key</strong>{" "}
              {fix}.
            </>
          ) : (
            <>
              To extend one that hasn&apos;t expired, use{" "}
              <strong>Edit key</strong> {fix}. An expired {noun} can&apos;t be
              extended, and replacing it requires permission to create a new
              one.
            </>
          )}
        </Text>
      </Flex>
    ),
  };
}
