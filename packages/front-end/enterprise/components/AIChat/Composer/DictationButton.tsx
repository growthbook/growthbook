import { PiMicrophone, PiSpinnerGap, PiStop } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import aiChatStyles from "@/enterprise/components/AIChat/AIChatPrimitives.module.scss";
import type { Dictation } from "./useDictation";
import styles from "./ChatComposer.module.scss";

const LABELS = {
  idle: "Dictate a message",
  starting: "Waiting for microphone access… Click to cancel",
  recording: "Stop dictating",
  transcribing: "Transcribing…",
} as const;

// Glyphs, not color alone: color-only state fails WCAG 1.4.1. Both waits share the spinner.
const ICONS = {
  idle: PiMicrophone,
  starting: PiSpinnerGap,
  recording: PiStop,
  transcribing: PiSpinnerGap,
} as const;

/** Mic toggle. Renders nothing when dictation isn't available to the org. */
export default function DictationButton({
  dictation: { available, status, toggle, micRef },
  disabled = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
}) {
  if (!available) return null;

  const recording = status === "recording";
  const spinning = status === "starting" || status === "transcribing";
  const label = LABELS[status];
  const Icon = ICONS[status];

  const button = (
    <button
      ref={micRef}
      type="button"
      className={`${styles.dictateButton}${
        recording ? ` ${styles.dictateButtonActive}` : ""
      }`}
      onClick={toggle}
      // Busy states stay undimmed; toggle already ignores the click while transcribing.
      disabled={disabled}
      aria-label={label}
      aria-pressed={recording}
      aria-busy={spinning}
    >
      {spinning ? (
        <span className={aiChatStyles.spinIcon}>
          <Icon size={16} />
        </span>
      ) : (
        <Icon size={16} />
      )}
    </button>
  );

  return (
    <Tooltip content={label}>
      {/* The button is the trigger so it opens on focus; a disabled one needs
          the wrapper, since pointer events never reach it. */}
      {disabled ? (
        <span className={styles.dictateTrigger}>{button}</span>
      ) : (
        button
      )}
    </Tooltip>
  );
}
