import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PiRobotBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import { useGrowthBotState } from "@/components/Agent/useGrowthBotState";
import GrowthBotStateNotice, {
  useGrowthBotFixes,
} from "@/components/Agent/GrowthBotStateNotice";
import styles from "./GrowthBotButton.module.scss";

const UNAVAILABLE_LABELS = {
  "not-in-plan": "GrowthBot, not included in your plan",
  off: "GrowthBot, turned off",
  "no-key": "GrowthBot, not set up",
  limit: "GrowthBot, usage limit reached",
};

export default function GrowthBotButton() {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();
  const { state, resetsAt } = useGrowthBotState();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Whether the message was showing as a press on the button began, before
  // the popover closes itself for a press outside it.
  const openAtPress = useRef<boolean | null>(null);
  // The AI agreement's modal, outside the popover: the message closes as it
  // opens, and focus comes back to the button after.
  const fixes = useGrowthBotFixes();
  const modalWasOpen = useRef(false);
  useEffect(() => {
    if (fixes.modalOpen) {
      setNoticeOpen(false);
    } else if (modalWasOpen.current) {
      buttonRef.current?.focus();
    }
    modalWasOpen.current = fixes.modalOpen;
  }, [fixes.modalOpen]);

  if (state === "default") {
    return (
      <>
        {fixes.modals}
        <Button
          // Enabling AI lands here, with focus coming back after its modal.
          ref={buttonRef}
          variant="outline"
          color="gray"
          size="sm"
          icon={<PiRobotBold />}
          // Where focus goes back to as the panel closes (AgentPanel.tsx).
          data-growthbot-trigger
          onClick={agentAvailable ? toggleAgentPanel : undefined}
          aria-label={
            agentOpen
              ? "Close GrowthBot, the GrowthBook AI assistant"
              : "Open GrowthBot, the GrowthBook AI assistant"
          }
          aria-pressed={agentAvailable ? agentOpen : undefined}
        >
          GrowthBot
        </Button>
      </>
    );
  }

  const unavailable = state !== "limit";
  const opensPanel = !unavailable && agentAvailable;

  const close = () => setNoticeOpen(false);
  const closeToButton = () => {
    close();
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  };

  const button = (
    <Button
      ref={buttonRef}
      variant="outline"
      color="gray"
      size="sm"
      className={clsx(unavailable && styles.unavailable)}
      data-growthbot-trigger
      icon={
        <span className={styles.iconWrap}>
          <PiRobotBold />
          {unavailable ? null : <span className={styles.limitDot} />}
        </span>
      }
      onClick={() => {
        if (opensPanel) {
          close();
          toggleAgentPanel();
          return;
        }
        const wasOpen = openAtPress.current ?? noticeOpen;
        openAtPress.current = null;
        if (wasOpen) {
          close();
          return;
        }
        setNoticeOpen(true);
        window.setTimeout(() => {
          const target =
            noticeRef.current?.querySelector<HTMLElement>("a, button") ??
            noticeRef.current;
          target?.focus();
        }, 0);
      }}
      aria-label={UNAVAILABLE_LABELS[state]}
      aria-pressed={opensPanel ? agentOpen : undefined}
      aria-expanded={opensPanel ? undefined : noticeOpen}
    >
      GrowthBot
    </Button>
  );

  return (
    <>
      {fixes.modals}
      <Popover
        anchorOnly
        // Its anchor as a wrapper of its own.
        triggerAsChild={false}
        open={noticeOpen}
        onOpenChange={(open) => {
          if (open) setNoticeOpen(true);
          else closeToButton();
        }}
        side="bottom"
        align="end"
        sideOffset={8}
        showArrow={false}
        contentClassName={styles.notice}
        contentStyle={{ padding: 0 }}
        // Focus is moved by the click (above) and on closing.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        trigger={
          <span
            className={styles.anchor}
            onPointerDownCapture={() => {
              openAtPress.current = noticeOpen;
            }}
          >
            {button}
          </span>
        }
        content={
          <div ref={noticeRef} tabIndex={-1} className={styles.noticeBody}>
            <GrowthBotStateNotice
              state={state}
              resetsAt={resetsAt}
              fixes={fixes}
            />
          </div>
        }
      />
    </>
  );
}
