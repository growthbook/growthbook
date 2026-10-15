import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PiRobotBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { Popover } from "@/ui/Popover";
import modalStandardStyles from "@/ui/Modal/Patterns/ModalStandard.module.scss";
import experimentHeaderStyles from "@/components/Experiment/TabbedPage/ExperimentHeader.module.scss";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import { useGrowthBotPrototype } from "@/components/Agent/prototypeGrowthBotState";
import GrowthBotStateNotice from "@/components/Agent/GrowthBotStateNotice";
import styles from "./GrowthBotButton.module.scss";

// The header's GrowthBot (AI Assistant) button (moved out of TopNav.tsx,
// unchanged in its default state).
//
// PROTOTYPE ONLY (set in review): with NEXT_PUBLIC_PROTOTYPE=true, two more
// states to demo (prototypeGrowthBotState.ts), each explained on hover and
// keyboard focus by its notice, in a popover styled as the side nav menus
// (set in review; was a plain tooltip). Hovering or focusing it only
// shows it; it stays while the pointer moves onto it, so its button can be
// clicked. Clicking pins it open and moves focus into it, for keyboards:
// - Disabled (off for the org, or not set up): the label and robot in a
//   quieter grey (--slate-11, still 4.5:1+), so it reads as unavailable but
//   stays focusable. Its notice says so, with Turn On in Settings for
//   admins, or who to ask.
// - Limit reached: the usual button, with a small amber dot on the robot.
//   Its notice offers Upgrade Plan, or, without "Can upgrade", to ask an
//   admin. Clicking opens the drawer, with the same notice as its empty
//   state and no new conversations (past ones stay readable, the notice
//   in place of the message box; AgentPanel.tsx); without the drawer (AI
//   not available), clicking pins the notice instead.
// The pause before hover shows the popover (set in review).
const HOVER_DELAY_MS = 400;

export default function GrowthBotButton() {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();
  const { state, canUpgrade } = useGrowthBotPrototype();
  const [noticeOpen, setNoticeOpen] = useState(false);
  // Opened by a click (focus moves in, and it stays until dismissed), not
  // just shown by hover or focus.
  const [pinned, setPinned] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // The pending hover open, or close.
  const hoverTimer = useRef<number | null>(null);
  // Set while focus goes back to the button after a pinned close, so that
  // focus doesn't show the popover again.
  const returningFocus = useRef(false);
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  // @/ui/Button styled as the experiment page's Check Hypothesis
  // (HypothesisField.tsx; set in review): outline, grey, small; a
  // --slate-6 outline darkening to --slate-9 on hover (.outlineButton),
  // --slate-12 text and robot at 400 (.ghostButton's weight), 6px corners,
  // and Button's own 4px between icon and label. Tried: ghost (small, and
  // medium at 28px tall), 500 text, an 8px gap, violet.
  const buttonProps = {
    variant: "outline",
    color: "gray",
    size: "sm",
    className: clsx(
      experimentHeaderStyles.outlineButton,
      modalStandardStyles.ghostButton,
    ),
    style: {
      borderRadius: "var(--radius-3)",
      color: "var(--slate-12)",
    },
  } as const;

  if (state === "default") {
    // PROTOTYPE: always shown (set in review), so the design's Assistant is
    // represented. Where AI is available it opens the global AI Assistant
    // drawer, as the sparkle did; elsewhere (no AI plan, or AI turned off)
    // it does nothing. ⌘J is a placeholder in the design; no shortcut yet.
    return (
      <Button
        {...buttonProps}
        icon={<PiRobotBold />}
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
    );
  }

  const disabled = state === "disabled";
  const opensDrawer = !disabled && agentAvailable;

  const cancelTimer = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  // Shown at once on keyboard focus, unless the drawer's open over it.
  const peek = () => {
    cancelTimer();
    if (!agentOpen) setNoticeOpen(true);
  };
  // On hover, after a pause (set in review; was instant), so passing over
  // the button doesn't flash it; already shown, it just stays.
  const hoverIn = () => {
    cancelTimer();
    if (noticeOpen || agentOpen) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setNoticeOpen(true);
    }, HOVER_DELAY_MS);
  };
  // A short pause on leaving, to bridge the gap to the popover (and a
  // pending hover open is dropped).
  const leave = () => {
    if (pinned) return;
    cancelTimer();
    hoverTimer.current = window.setTimeout(() => setNoticeOpen(false), 150);
  };
  const close = () => {
    cancelTimer();
    setNoticeOpen(false);
    setPinned(false);
  };
  // Closed after a click pinned it (Escape, or a click outside): focus back
  // on the button, which it was moved from.
  const closePinned = () => {
    close();
    returningFocus.current = true;
    window.setTimeout(() => {
      buttonRef.current?.focus();
      returningFocus.current = false;
    }, 0);
  };

  const button = (
    <Button
      {...buttonProps}
      ref={buttonRef}
      className={clsx(buttonProps.className, disabled && styles.unavailable)}
      style={{
        ...buttonProps.style,
        color: disabled ? "var(--slate-11)" : buttonProps.style.color,
      }}
      icon={
        <span className={styles.iconWrap}>
          <PiRobotBold />
          {disabled ? null : <span className={styles.limitDot} />}
        </span>
      }
      onClick={() => {
        if (opensDrawer) {
          close();
          toggleAgentPanel();
          return;
        }
        if (pinned) {
          close();
          return;
        }
        // Pinned: open, with focus on its first control (or the notice).
        cancelTimer();
        setPinned(true);
        setNoticeOpen(true);
        window.setTimeout(() => {
          const target =
            noticeRef.current?.querySelector<HTMLElement>("a, button") ??
            noticeRef.current;
          target?.focus();
        }, 0);
      }}
      aria-label={
        disabled ? "GrowthBot, turned off" : "GrowthBot, usage limit reached"
      }
      aria-pressed={opensDrawer ? agentOpen : undefined}
      aria-expanded={opensDrawer ? undefined : noticeOpen}
    >
      GrowthBot
    </Button>
  );

  return (
    <Popover
      anchorOnly
      // Its anchor as a wrapper of its own (Popover's unstyling class stays
      // on that wrapper).
      triggerAsChild={false}
      open={noticeOpen}
      onOpenChange={(open) => {
        if (open) setNoticeOpen(true);
        else if (pinned) closePinned();
        else close();
      }}
      side="bottom"
      align="end"
      sideOffset={8}
      // No pointer, as the side nav's menus (set in review).
      showArrow={false}
      contentClassName={clsx(
        styles.notice,
        listTableStyles.menuShadow,
        listTableStyles.menuOutline,
      )}
      contentStyle={{ padding: 0 }}
      // Focus stays put when it's only shown; a click moves it (above).
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      trigger={
        <span
          className={styles.anchor}
          onMouseEnter={hoverIn}
          onMouseLeave={leave}
          onFocus={(e) => {
            // Keyboard focus only, not the focus a click gives.
            // A tick later: opened during the focus event itself, the
            // popover would take that same event as focus outside it and
            // close.
            if (e.target.matches(":focus-visible") && !returningFocus.current)
              window.setTimeout(peek, 0);
          }}
          onBlur={(e) => {
            if (!noticeRef.current?.contains(e.relatedTarget as Node)) leave();
          }}
        >
          {button}
        </span>
      }
      content={
        <div
          ref={noticeRef}
          tabIndex={-1}
          className={styles.noticeBody}
          onMouseEnter={cancelTimer}
          onMouseLeave={leave}
        >
          <GrowthBotStateNotice
            state={disabled ? "disabled" : "limit"}
            canUpgrade={canUpgrade}
          />
        </div>
      }
    />
  );
}
