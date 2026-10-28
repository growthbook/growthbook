import { Flex } from "@radix-ui/themes";
import { PiGauge } from "react-icons/pi";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { formatResetsIn } from "./growthBotState";
import styles from "./GrowthBotStateNotice.module.scss";

// As the upgrade modal's Enterprise path.
const CONTACT_SALES_URL = "https://www.growthbook.io/demo";

// The panel's message at the daily limit (Cloud).
export default function GrowthBotStateNotice({
  resetsAt,
  centered = false,
}: {
  resetsAt?: number | null;
  centered?: boolean;
}) {
  const canManageBilling = usePermissionsUtil().canManageBilling();
  const buttonSize = centered ? "md" : "sm";

  return (
    <Flex
      direction={centered ? "column" : "row"}
      gap="2"
      align={centered ? "center" : "start"}
      className={centered ? styles.centered : undefined}
    >
      <PiGauge
        size={centered ? 24 : 18}
        className={styles.titleIcon}
        aria-hidden="true"
      />
      <Flex
        direction="column"
        minWidth="0"
        align={centered ? "center" : undefined}
      >
        <Text weight={centered ? "medium" : "semibold"}>
          You&apos;ve reached your AI Assistant limit
        </Text>
        <Text
          as="p"
          size={centered ? "sm" : "md"}
          color="text-mid"
          m="0"
          mt={centered ? "2" : "0"}
        >
          Your organization has used all of today&apos;s AI usage.
          {resetsAt ? (
            <>
              <br />
              It resets{" "}
              <Text size="inherit" weight="medium">
                {formatResetsIn(resetsAt, Date.now())}
              </Text>
              .
            </>
          ) : null}
          <br />
          <br />
          Need more? Enterprise plans have no daily limit.
        </Text>
        <Flex className={styles.action}>
          {canManageBilling ? (
            <LinkButton href={CONTACT_SALES_URL} external size={buttonSize}>
              Contact sales
            </LinkButton>
          ) : (
            <Text as="p" size={centered ? "sm" : "md"} color="text-mid" m="0">
              Contact your admin to upgrade.
            </Text>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}
