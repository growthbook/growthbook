import { PiMicrophone, PiMicrophoneSlash, PiSpinnerGap } from "react-icons/pi";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import aiChatStyles from "@/enterprise/components/AIChat/AIChatPrimitives.module.scss";
import type { Dictation } from "./useDictation";
import styles from "./ChatComposer.module.scss";

/** Mic toggle. Renders nothing when dictation isn't available to the org. */
export default function DictationButton({
  dictation: { available, recording, transcribing, error, toggle },
  disabled = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
}) {
  if (!available) return null;

  const label = recording
    ? "Stop dictating"
    : transcribing
      ? "Transcribing…"
      : "Dictate a message";

  const Icon = error
    ? PiMicrophoneSlash
    : transcribing
      ? PiSpinnerGap
      : PiMicrophone;

  return (
    <span className={styles.dictateWrapper}>
      {/* A slash on the icon alone reads as "unavailable" rather than as a
          recoverable error, and nobody hovers a control they didn't click. */}
      {error && (
        <div className={styles.dictateError} role="status" aria-live="polite">
          <HelperText status="error" size="sm">
            {error}
          </HelperText>
        </div>
      )}
      <Tooltip content={label}>
        {/* Radix tooltips need an enabled trigger — pointer events never reach
            a disabled button, so the wrapper is what gets hovered. */}
        <span className={styles.dictateTrigger}>
          <button
            type="button"
            className={`${styles.dictateButton}${recording ? ` ${styles.dictateButtonActive}` : ""}`}
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
    </span>
  );
}
