import { ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { IconType } from "react-icons";
import { PiGauge, PiKey, PiLockSimple, PiPlugs } from "react-icons/pi";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import {
  GrowthBotState,
  growthBotLimitResetsIn,
} from "./prototypeGrowthBotState";
import styles from "./GrowthBotStateNotice.module.scss";

// PROTOTYPE ONLY (set in review): what GrowthBot says when it can't be
// used, in the header button's popover (GrowthBotButton.tsx) and, for the
// limit, in the drawer, as its empty state or in place of the message box
// (AgentPanel.tsx). One per state the plan and hosting can have
// (prototypeGrowthBotState.ts): people who can manage billing and settings
// get the fix; everyone else is told to contact their admin, in the
// button's place.

// TODO(settings redesign): the new Settings page
// (SettingsRedesignPlaceholder.tsx) has no sections yet. Point these at its
// General section (where AI is turned on) and its AI & Prompts section
// (where the API key is set up) once they exist. Meanwhile both go to
// today's AI & Prompts tab (/settings#ai), where both live; in the
// prototype, /settings is the placeholder.
const SETTINGS_GENERAL_HREF = "/settings#ai";
const SETTINGS_AI_PROMPTS_HREF = "/settings#ai";

// Talk to Sales, as the upgrade modal's Enterprise path
// (components/Settings/UpgradeModal): the demo page, in a new tab.
const CONTACT_SALES_URL = "https://www.growthbook.io/demo";

export default function GrowthBotStateNotice({
  state,
  canManage,
  centered = false,
}: {
  state: Exclude<GrowthBotState, "default">;
  // Can manage billing and settings (the prototype's setting).
  canManage: boolean;
  // As the drawer's empty state (set in review): the icon above the title,
  // the text centred, and a default-size button.
  centered?: boolean;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const buttonSize = centered ? "md" : "sm";

  const notice: {
    Icon: IconType;
    title: string;
    description: ReactNode;
    // The fix, for people who can manage billing and settings.
    action: ReactNode;
    // In the button's place, for everyone else.
    contactAdmin: string;
  } =
    state === "not-in-plan"
      ? {
          // A lock: it's not in the plan.
          Icon: PiLockSimple,
          title: "GrowthBot isn't included in your plan",
          description:
            "GrowthBot, the GrowthBook AI assistant, is available on the Pro and Enterprise plans.",
          action: (
            <Button size={buttonSize} onClick={() => setUpgradeOpen(true)}>
              Upgrade Plan
            </Button>
          ),
          contactAdmin: "Contact your admin to upgrade your plan.",
        }
      : state === "limit"
        ? {
            Icon: PiGauge,
            title: "You've reached your GrowthBot limit",
            description: (
              <>
                Your organization has used all of today&apos;s AI usage.
                {/* When it resets on a line of its own (set in review). */}
                <br />
                It resets{" "}
                <span className={styles.date}>{growthBotLimitResetsIn()}</span>.
                {/* Why Contact Sales, on a line of its own below the reset
                  time, a blank line between them (set in review). */}
                <br />
                <br />
                Need more? Enterprise plans have no daily limit.
              </>
            ),
            // Only Enterprise removes the limit, so Contact Sales, not
            // Upgrade Plan.
            action: (
              <LinkButton href={CONTACT_SALES_URL} external size={buttonSize}>
                Contact Sales
              </LinkButton>
            ),
            contactAdmin: "Contact your admin to upgrade.",
          }
        : state === "off"
          ? {
              // An unplugged icon (set in review; tried power, which read as
              // "turn on").
              Icon: PiPlugs,
              title: "GrowthBot is turned off",
              description:
                "GrowthBot, the GrowthBook AI assistant, is turned off for your organization.",
              action: (
                <LinkButton href={SETTINGS_GENERAL_HREF} size={buttonSize}>
                  Turn On in Settings
                </LinkButton>
              ),
              contactAdmin: "Contact your admin to turn it on.",
            }
          : {
              Icon: PiKey,
              title: "GrowthBot isn't set up",
              description:
                "GrowthBot, the GrowthBook AI assistant, needs an AI provider API key before it can be used.",
              action: (
                <LinkButton href={SETTINGS_AI_PROMPTS_HREF} size={buttonSize}>
                  Set Up API Key
                </LinkButton>
              ),
              contactAdmin: "Contact your admin to set it up.",
            };
  const { Icon } = notice;

  // The icon to the left of the title (above it as the drawer's empty
  // state), the description in --slate-11 right under the title, and 16px
  // above the button, or, without the rights, who to contact in its place
  // (so the description keeps to two lines).
  return (
    <Flex
      direction={centered ? "column" : "row"}
      gap="2"
      align={centered ? "center" : "start"}
      className={centered ? styles.centered : undefined}
    >
      {/* 24px as the empty state, as the details page's comments empty
        state (set in review; tried 20px); 18px beside the title. */}
      <Icon
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
        <Text weight={centered ? "medium" : "semibold"}>{notice.title}</Text>
        <p className={styles.description}>{notice.description}</p>
        <Flex className={styles.action}>
          {canManage ? (
            notice.action
          ) : (
            <p className={styles.description}>{notice.contactAdmin}</p>
          )}
        </Flex>
      </Flex>
      {upgradeOpen ? (
        <UpgradeModal
          close={() => setUpgradeOpen(false)}
          source="growthbot-not-in-plan"
          commercialFeature="ai-suggestions"
        />
      ) : null}
    </Flex>
  );
}
