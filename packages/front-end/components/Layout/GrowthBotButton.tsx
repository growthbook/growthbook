import { CSSProperties, useRef, useState } from "react";
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
import {
  usePrototypeDockedGrowthBot,
  usePrototypeExistingPageColors,
} from "./PrototypeControls";
import styles from "./GrowthBotButton.module.scss";

// The header's GrowthBot (AI Assistant) button (moved out of TopNav.tsx,
// unchanged in its default state).
//
// PROTOTYPE ONLY (set in review): with NEXT_PUBLIC_PROTOTYPE=true, more
// states to demo, as the prototype's plan and hosting allow
// (prototypeGrowthBotState.ts; set in review), each explained by its notice,
// in a popover styled as the side nav menus (set in review; was a plain
// tooltip). It opens on a click, Enter or Space only (set in review; hover
// and keyboard focus showed it too), moving focus into it; a click outside
// or Esc closes it, focus back on the button, as does another click on the
// button:
// - Unavailable (not in the plan, AI turned off, or no API key): the label
//   and robot in a quieter grey (--slate-11, still 4.5:1+), so it reads as
//   unavailable but stays focusable. Its notice says why, with the fix for
//   people who can manage billing and settings (Upgrade Plan, Turn On in
//   Settings, Set Up API Key), or to contact their admin.
// - Limit reached (Pro on Cloud): the usual button, with a small amber dot
//   on the robot. Its notice offers Contact Sales, or to contact their
//   admin. Clicking opens the drawer, with the same notice as its empty
//   state and no new conversations (past ones stay readable, the notice
//   in place of the message box; AgentPanel.tsx); without the drawer (AI
//   not available), clicking opens the notice instead.

export default function GrowthBotButton() {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();
  const { state, canManage } = useGrowthBotPrototype();
  // PROTOTYPE: with "Interim colors" on, the button's look before the
  // redesign (set in review): Button's own grey outline, without the
  // Check Hypothesis styling below.
  const interimColors = usePrototypeExistingPageColors();
  // PROTOTYPE ("Docked GrowthBot", set in review): while its docked rail is
  // open, the button is shown as on, as the side nav's current page is
  // (.dockedOpen): a grey fill, keeping its outline. Its pressed state says
  // so to screen readers too.
  const dockedOpen = usePrototypeDockedGrowthBot() && agentOpen;
  const [noticeOpen, setNoticeOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Whether the notice was showing as a press on the button began, before
  // the popover closes itself for a press outside it.
  const openAtPress = useRef<boolean | null>(null);

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
      !interimColors && [
        experimentHeaderStyles.outlineButton,
        modalStandardStyles.ghostButton,
      ],
      // Fades out while the full-height docked rail is open (set in
      // review).
      styles.fades,
      dockedOpen && styles.dockedOpen,
    ),
    style: (interimColors
      ? {}
      : {
          borderRadius: "var(--radius-3)",
          color: "var(--slate-12)",
        }) as CSSProperties,
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

  // Everything but the limit: GrowthBot can't be used at all.
  const disabled = state !== "limit";
  const opensDrawer = !disabled && agentAvailable;

  const close = () => setNoticeOpen(false);
  // Closed by Esc or a click outside: focus back on the button, which it
  // was moved from.
  const closeToButton = () => {
    close();
    window.setTimeout(() => buttonRef.current?.focus(), 0);
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
        // Already showing: a click closes it (set in review; it closed on
        // the press, as a click outside it, then opened again on the
        // click). Read as the press began.
        const wasOpen = openAtPress.current ?? noticeOpen;
        openAtPress.current = null;
        if (wasOpen) {
          close();
          return;
        }
        // Open, with focus on its first control (or the notice).
        setNoticeOpen(true);
        window.setTimeout(() => {
          const target =
            noticeRef.current?.querySelector<HTMLElement>("a, button") ??
            noticeRef.current;
          target?.focus();
        }, 0);
      }}
      aria-label={
        state === "not-in-plan"
          ? "GrowthBot, not included in your plan"
          : state === "off"
            ? "GrowthBot, turned off"
            : state === "no-key"
              ? "GrowthBot, not set up"
              : "GrowthBot, usage limit reached"
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
        else closeToButton();
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
          <GrowthBotStateNotice state={state} canManage={canManage} />
        </div>
      }
    />
  );
}
