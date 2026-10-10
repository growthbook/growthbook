import { Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import { ago } from "shared/dates";
import { isExpired } from "shared/api-key-expiration";
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
  // The label names the worst state, so it counts only tokens in it
  const count = severe ? expiredCount : tokens.length;
  const label =
    count === 1
      ? `${severe ? "Expired" : "Expiring"} access token`
      : `${count} ${severe ? "expired" : "expiring"} access tokens`;

  return (
    <Tooltip
      body={
        <Flex direction="column" gap="2" className={styles["notice-tooltip"]}>
          {tokens.map((t) => (
            <Text as="div" key={t.id}>
              <strong>{t.description || t.id}</strong>{" "}
              {isExpired(t.expiresAt)
                ? `expired ${ago(t.expiresAt as Date)} but was used ${ago(t.lastUsed as Date)}.`
                : `expires ${ago(t.expiresAt as Date)}.`}
            </Text>
          ))}
          <Text as="div">
            Replace a token with <strong>Copy settings to new key</strong> on
            your Personal Access Tokens page.
          </Text>
        </Flex>
      }
    >
      <Link
        href="/account/personal-access-tokens"
        color={severe ? "red" : "amber"}
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
        {label}
      </Link>
    </Tooltip>
  );
}
