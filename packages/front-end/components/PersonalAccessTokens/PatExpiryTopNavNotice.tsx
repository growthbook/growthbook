import { Box } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import { ago } from "shared/dates";
import { isExpired } from "shared/api-key-expiration";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import styles from "@/components/Layout/AccountPlanNotices.module.scss";

// Expiry events go only to org webhooks, so this is how a member hears about their own tokens.
export default function PatExpiryTopNavNotice() {
  const { expiringPersonalAccessTokens: tokens } = useUser();
  if (!tokens.length) return null;

  const expiredCount = tokens.filter((t) => isExpired(t.expiresAt)).length;
  const severe = expiredCount > 0;
  // The pill names the worst state, so it counts only tokens in it
  const count = severe ? expiredCount : tokens.length;
  const color = severe ? "red" : "amber";

  return (
    <Tooltip
      body={
        <Box className={styles["notice-tooltip"]}>
          <Box asChild pl="4" mb="2">
            <ul>
              {tokens.map((t) => {
                const name = t.description || t.id;
                return (
                  <li key={t.id}>
                    {isExpired(t.expiresAt)
                      ? `${name} expired ${ago(t.expiresAt as Date)} but was used ${ago(t.lastUsed as Date)}.`
                      : `${name} expires ${ago(t.expiresAt as Date)}.`}
                  </li>
                );
              })}
            </ul>
          </Box>
          <Text as="p" mb="0">
            Replace a token with <strong>Copy settings to new key</strong> on
            your Personal Access Tokens page.
          </Text>
        </Box>
      }
    >
      <Link
        href="/account/personal-access-tokens"
        color={color}
        underline="hover"
        className={
          styles[severe ? "error-notification" : "warning-notification"]
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <PiWarningFill size={15} />
        {severe ? "Expired" : "Expiring"} access token{count === 1 ? "" : "s"}
        <Badge
          label={String(count)}
          color={color}
          variant="solid"
          radius="full"
          size="xs"
        />
      </Link>
    </Tooltip>
  );
}
