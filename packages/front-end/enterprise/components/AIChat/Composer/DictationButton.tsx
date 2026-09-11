import {
  PiMicrophone,
  PiMicrophoneSlash,
  PiSpinnerGap,
  PiStop,
} from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import aiChatStyles from "@/enterprise/components/AIChat/AIChatPrimitives.module.scss";
import type { Dictation } from "./useDictation";
import styles from "./ChatComposer.module.scss";

/** Mic toggle. Renders nothing when dictation isn't available to the org. */
export default function DictationButton({
  dictation: { available, recording, transcribing, error, toggle },
  disabled = false,
  primary = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
  /** Takes the send button's filled treatment when there's nothing to send. */
  primary?: boolean;
}) {
  if (!available) return null;

  const label = recording
    ? "Stop dictating"
    : transcribing
      ? "Transcribing…"
      : "Dictate a message";

  // Recording gets its own glyph, not just red: color-only state fails WCAG 1.4.1.
  const Icon = error
    ? PiMicrophoneSlash
    : transcribing
      ? PiSpinnerGap
      : recording
        ? PiStop
        : PiMicrophone;

  return (
    <Tooltip content={label}>
      {/* Radix tooltips need an enabled trigger — pointer events never reach a
          disabled button, so the wrapper is what gets hovered. */}
      <span className={styles.dictateTrigger}>
        <button
          type="button"
          // The two buttons already share their geometry, so the filled
          // treatment is just the send button's own class.
          className={`${primary ? styles.sendButton : styles.dictateButton}${
            recording ? ` ${styles.dictateButtonActive}` : ""
          }`}
          onClick={toggle}
          disabled={disabled || transcribing}
          aria-label={label}
          aria-pressed={recording}
          aria-busy={transcribing}
        >
          {transcribing ? (
            <span className={aiChatStyles.spinIcon}>
              <Icon size={16} />
            </span>
          ) : (
            <Icon size={16} />
          )}
        </button>
      </span>
    </Tooltip>
  );
}
