import { useFeature } from "@growthbook/growthbook-react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { BsQuestionLg, BsXLg } from "react-icons/bs";
import { FaArrowRight } from "react-icons/fa";
import { PiChatTeardropFill } from "react-icons/pi";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { GBPremiumBadge } from "@/components/Icons";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import styles from "./InAppHelp.module.scss";

/**
 * How much of the bottom-right corner the chat bubble takes when Pylon owns it.
 * Its widget is an iframe of someone else's, so this is the one measurement we
 * cannot take ourselves.
 */
const PYLON_CLEARANCE_PX = 76;

export default function InAppHelp() {
  const router = useRouter();
  const launcher = useRef<HTMLButtonElement>(null);
  const config = useFeature("pylon-config").value;
  const [showFreeHelpWidget, setShowFreeHelpWidget] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const {
    name,
    email,
    pylonHmacHash,
    hasCommercialFeature,
    commercialFeatures,
  } = useUser();
  const showUpgradeModal = !hasCommercialFeature("livechat") && isCloud();

  useEffect(() => {
    if (window["pylon"] || !config) return;

    if (hasCommercialFeature("livechat") && isCloud()) {
      const scriptElement = document.createElement("script");
      scriptElement.innerHTML = config.script_content;

      document.body.appendChild(scriptElement);
      window["pylon"] = {
        chat_settings: {
          app_id: config.app_id,
          email_hash: pylonHmacHash,
          email,
          name,
        },
      };
    }
  }, [config, commercialFeatures]);

  // Whatever ends in the bottom-right corner — a comment box, a survey card —
  // needs to keep clear of whichever launcher is running. Publish the room it
  // takes rather than have each of them carry its own guess.
  useEffect(() => {
    const root = document.documentElement;
    const publish = (px: number) =>
      root.style.setProperty("--help-launcher-clearance", `${px}px`);

    if (window["pylon"]) {
      publish(PYLON_CLEARANCE_PX);
      return () => publish(0);
    }

    const el = launcher.current;
    if (!el) {
      publish(0);
      return;
    }
    const measure = () =>
      publish(
        Math.max(
          0,
          Math.round(window.innerHeight - el.getBoundingClientRect().top),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      publish(0);
    };
  });

  // Hide on presentation view (fullscreen present mode)
  if (router.pathname.startsWith("/present/")) return null;

  // If the Pylon key exists on the window, we're showing the Pylon widget, so don't show the freeHelpModal
  if (window["pylon"]) return null;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="in-app-help"
          commercialFeature="livechat"
        />
      )}

      {showFreeHelpWidget && (
        <Box
          style={{
            position: "fixed",
            right: "15px",
            // Above the launcher, which sits 15px off the bottom.
            bottom: "80px",
            width: "300px",
            zIndex: 10,
            background: "var(--color-panel-solid)",
            border: "1px solid var(--gray-a5)",
            borderRadius: "var(--radius-4)",
            boxShadow: "var(--shadow-4)",
            overflow: "hidden",
          }}
        >
          <Flex
            align="center"
            gap="2"
            px="4"
            py="3"
            // The heading takes its colour from here: on the violet bar it is
            // white, and `Heading` styles its own only for the text scales.
            style={{ background: "var(--violet-9)", color: "white" }}
          >
            <img
              alt="GrowthBook"
              src="/logo/growth-book-logomark-white.svg"
              style={{ height: 22 }}
            />
            <Heading as="h4" size="sm" mb="0">
              How can we help?
            </Heading>
          </Flex>
          <Flex direction="column" gap="3" p="4">
            <Text weight="medium" color="text-high">
              Have a question?
            </Text>
            <Button
              icon={<FaArrowRight />}
              iconPosition="right"
              onClick={() =>
                window.open(
                  "https://slack.growthbook.io/?ref=app-top-nav",
                  "_blank",
                  "noopener",
                )
              }
            >
              Join the Slack community
            </Button>
            <Button
              variant="outline"
              icon={<FaArrowRight />}
              iconPosition="right"
              onClick={() =>
                window.open("https://docs.growthbook.io/", "_blank", "noopener")
              }
            >
              View docs
            </Button>
            {showUpgradeModal && (
              <>
                <Separator size="4" />
                <Text weight="medium" color="text-high">
                  Upgrade to unlock live chat support and premium features.
                </Text>
                <Button
                  variant="soft"
                  icon={<GBPremiumBadge />}
                  iconPosition="right"
                  onClick={() => setUpgradeModal(true)}
                >
                  Upgrade now
                </Button>
              </>
            )}
          </Flex>
        </Box>
      )}
      {showFreeHelpWidget ? (
        <IconButton
          ref={launcher}
          type="button"
          size="4"
          radius="full"
          color="violet"
          aria-label="Close help"
          aria-expanded
          onClick={() => setShowFreeHelpWidget(false)}
          style={{
            position: "fixed",
            right: "15px",
            bottom: "15px",
            zIndex: 10,
            height: "50px",
            width: "50px",
            margin: 0,
            cursor: "pointer",
          }}
        >
          <BsXLg size={20} />
        </IconButton>
      ) : (
        <button
          ref={launcher}
          type="button"
          className={styles.chatLauncher}
          aria-label="Help"
          aria-expanded={false}
          onClick={() => setShowFreeHelpWidget(true)}
        >
          <span className={styles.chatMark}>
            <PiChatTeardropFill size={56} />
            <BsQuestionLg className={styles.chatMarkGlyph} size={20} />
          </span>
        </button>
      )}
    </>
  );
}
