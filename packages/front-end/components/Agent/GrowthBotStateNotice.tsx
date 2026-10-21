import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { IconType } from "react-icons";
import { PiGauge, PiKey, PiLockSimple, PiPlugs } from "react-icons/pi";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnableAI } from "@/hooks/useEnableAI";
import { formatResetsIn, GrowthBotState } from "./growthBotState";
import styles from "./GrowthBotStateNotice.module.scss";

// TODO(settings redesign): point at the new Settings page's AI & Prompts
// section once it's live. Today's AI & Prompts tab, as EnableAICallout.
export const SETTINGS_AI_PROMPTS_HREF = "/settings/#ai";

// As the upgrade modal's Enterprise path.
const CONTACT_SALES_URL = "https://www.growthbook.io/demo";

// Its modal renders outside the header button's popover, so it outlasts the
// message, which closes for it.
export function useGrowthBotFixes() {
  const { enableAI, optInModal } = useEnableAI("growthbot");
  return {
    enableAI,
    modalOpen: optInModal !== null,
    modals: optInModal,
  };
}
type GrowthBotFixes = ReturnType<typeof useGrowthBotFixes>;

export default function GrowthBotStateNotice({
  state,
  resetsAt,
  centered = false,
  fixes,
}: {
  state: Exclude<GrowthBotState, "default">;
  resetsAt?: number | null;
  centered?: boolean;
  // Without it, the notice renders its own modals.
  fixes?: GrowthBotFixes;
}) {
  const permissionsUtil = usePermissionsUtil();
  const canManageBilling = permissionsUtil.canManageBilling();
  const canManageSettings = permissionsUtil.canManageOrgSettings();
  const ownFixes = useGrowthBotFixes();
  const { enableAI } = fixes ?? ownFixes;
  const buttonSize = centered ? "md" : "sm";

  const notice: {
    Icon: IconType;
    title: string;
    description: ReactNode;
    action: ReactNode | null;
    contactAdmin: string | null;
  } =
    state === "not-in-plan"
      ? {
          Icon: PiLockSimple,
          title: "GrowthBot isn't included in your plan",
          // Self-hosted only (every Cloud plan has AI), where AI is Enterprise-only:
          // upgrading to Pro doesn't add it.
          description: (
            <>
              Your current plan does not include AI features.
              <br />
              AI is included with Enterprise plans.
            </>
          ),
          action: canManageBilling ? (
            <LinkButton href={CONTACT_SALES_URL} external size={buttonSize}>
              Contact sales
            </LinkButton>
          ) : null,
          contactAdmin: "Contact your admin to upgrade your plan.",
        }
      : state === "limit"
        ? {
            Icon: PiGauge,
            title: "You've reached your GrowthBot limit",
            description: (
              <>
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
              </>
            ),
            action: canManageBilling ? (
              <LinkButton href={CONTACT_SALES_URL} external size={buttonSize}>
                Contact sales
              </LinkButton>
            ) : null,
            contactAdmin: "Contact your admin to upgrade.",
          }
        : state === "off"
          ? {
              Icon: PiPlugs,
              title: "GrowthBot is turned off",
              // Without permission, the description already says to ask an admin.
              description: canManageSettings
                ? "You must first enable AI for your organization to use this feature."
                : "AI features are disabled for your organization. Ask an admin to enable it.",
              action: canManageSettings ? (
                <Button size={buttonSize} onClick={enableAI}>
                  Enable AI
                </Button>
              ) : null,
              contactAdmin: null,
            }
          : {
              Icon: PiKey,
              title: "GrowthBot isn't set up",
              description:
                "You must configure provider API keys in order to use AI features.",
              action: canManageSettings ? (
                <LinkButton href={SETTINGS_AI_PROMPTS_HREF} size={buttonSize}>
                  View settings
                </LinkButton>
              ) : null,
              contactAdmin: "Contact your admin to set it up.",
            };
  const { Icon } = notice;

  return (
    <Flex
      direction={centered ? "column" : "row"}
      gap="2"
      align={centered ? "center" : "start"}
      className={centered ? styles.centered : undefined}
    >
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
        <Text weight={centered ? "medium" : "semibold"}>{notice.title}</Text>
        <Text
          as="p"
          size={centered ? "sm" : "md"}
          color="text-mid"
          m="0"
          mt={centered ? "2" : "0"}
        >
          {notice.description}
        </Text>
        {notice.action || notice.contactAdmin ? (
          <Flex className={styles.action}>
            {notice.action ?? (
              <Text as="p" size={centered ? "sm" : "md"} color="text-mid" m="0">
                {notice.contactAdmin}
              </Text>
            )}
          </Flex>
        ) : null}
      </Flex>
      {fixes ? null : ownFixes.modals}
    </Flex>
  );
}
