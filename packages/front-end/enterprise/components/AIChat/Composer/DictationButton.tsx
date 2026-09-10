import { PiMicrophone, PiMicrophoneSlash, PiSpinnerGap } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import type { Dictation } from "./useDictation";
import styles from "./ChatComposer.module.scss";

/**
 * Mic toggle for the composer. Renders nothing when the org has no
 * transcription model available — see useDictation.
 */
export default function DictationButton({
  dictation,
  disabled = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
}) {
  const { available, recording, transcribing, error, toggle } = dictation;
  if (!available) return null;

  const label = error
    ? error
    : recording
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
    <Tooltip content={label}>
      <button
        type="button"
        className={`${styles.dictateButton}${recording ? ` ${styles.dictateButtonActive}` : ""}`}
        onClick={toggle}
        disabled={disabled || transcribing}
        aria-label={label}
        aria-pressed={recording}
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}
