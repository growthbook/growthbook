import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiGauge, PiPlugs } from "react-icons/pi";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { GrowthBotState, growthBotResetDate } from "./prototypeGrowthBotState";
import styles from "./GrowthBotStateNotice.module.scss";

// PROTOTYPE ONLY (set in review): what GrowthBot says when it can't be
// used, in the header button's popover (GrowthBotButton.tsx) and, for the
// limit, at the foot of the drawer in place of the message box
// (AgentPanel.tsx).

export default function GrowthBotStateNotice({
  state,
  canUpgrade,
  centered = false,
}: {
  state: Exclude<GrowthBotState, "default">;
  canUpgrade: boolean;
  // As the drawer's empty state (set in review): the icon above the title,
  // the text centred, and a default-size button.
  centered?: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (state === "disabled") {
    // Admins can turn it on (Settings → AI); others are told who can.
    const canManage = permissionsUtil.canManageOrgSettings();
    return (
      // An unplugged icon to the left of the title (set in review; tried
      // power, which read as "turn on"), with the description and button
      // lined up under the title's text, not the icon. The description in
      // --slate-11 (set in review; was Text's text-mid), right under the
      // title (set in review; was 8px), and 16px above the button.
      // Without the rights to turn it on, who can, in the button's place,
      // so the description keeps to two lines.
      <Flex gap="2" align="start">
        <PiPlugs size={18} className={styles.titleIcon} aria-hidden="true" />
        <Flex direction="column" minWidth="0">
          <Text weight="semibold">GrowthBot is turned off</Text>
          <p className={styles.description}>
            GrowthBot, the GrowthBook AI assistant, isn&apos;t turned on or set
            up for your organization yet.
          </p>
          <Flex className={styles.action}>
            {canManage ? (
              <LinkButton href="/settings#ai" size="sm">
                Turn On in Settings
              </LinkButton>
            ) : (
              <p className={styles.description}>
                Ask an admin to turn it on in Settings.
              </p>
            )}
          </Flex>
        </Flex>
      </Flex>
    );
  }

  // As the turned-off notice (set in review): a gauge icon to the left of
  // the title, the description in --slate-11 right under it, and 16px
  // above Upgrade Plan, or, without "Can upgrade", who to ask in its
  // place (moved out of the description, so it keeps to two lines).
  return (
    <Flex
      direction={centered ? "column" : "row"}
      gap="2"
      align={centered ? "center" : "start"}
      className={centered ? styles.centered : undefined}
    >
      {/* 24px as the empty state, as the details page's comments empty
        state (set in review; tried 20px); 18px beside the title. */}
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
        {/* As the empty state, at 500, as the comments empty state's title. */}
        <Text weight={centered ? "medium" : "semibold"}>
          You&apos;ve reached your GrowthBot limit
        </Text>
        <p className={styles.description}>
          You&apos;ve used all of your AI usage for this month.
          {/* The reset date on a line of its own (set in review). */}
          <br />
          It resets <span className={styles.date}>{growthBotResetDate()}</span>.
        </p>
        <Flex className={styles.action}>
          {canUpgrade ? (
            <Button
              size={centered ? "md" : "sm"}
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade Plan
            </Button>
          ) : (
            <p className={styles.description}>
              Ask an admin to upgrade your plan for more.
            </p>
          )}
        </Flex>
      </Flex>
      {upgradeOpen ? (
        <UpgradeModal
          close={() => setUpgradeOpen(false)}
          source="growthbot-limit-reached"
          commercialFeature="ai-suggestions"
        />
      ) : null}
    </Flex>
  );
}
