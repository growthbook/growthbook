import { PiMicrophone, PiMicrophoneSlash, PiSpinnerGap } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
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

  // The tooltip doubles as the error surface, paired with the slashed icon.
  const label =
    error ??
    (recording
      ? "Stop dictating"
      : transcribing
        ? "Transcribing…"
        : "Dictate a message");

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
