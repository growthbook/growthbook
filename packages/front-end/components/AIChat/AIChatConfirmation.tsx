import { FC } from "react";
import { PiShieldWarning, PiCheck, PiX } from "react-icons/pi";
import { AIChatConfirmationAction } from "shared/ai-chat";
import styles from "./AIChatPanel.module.scss";

interface Props {
  action: AIChatConfirmationAction;
  onConfirm: (action: AIChatConfirmationAction, confirmed: boolean) => void;
}

const AIChatConfirmation: FC<Props> = ({ action, onConfirm }) => {
  const isPending = action.status === "pending_confirmation";

  return (
    <div className={styles.confirmationCard}>
      <div className={styles.confirmationHeader}>
        <PiShieldWarning size={18} />
        <span>Action Requires Confirmation</span>
      </div>
      <div className={styles.confirmationDescription}>{action.description}</div>
      {action.args && Object.keys(action.args).length > 0 && (
        <div className={styles.confirmationArgs}>
          {Object.entries(action.args).map(([key, value]) => (
            <div key={key} className={styles.confirmationArg}>
              <span className={styles.argKey}>{key}:</span>{" "}
              <span className={styles.argValue}>{String(value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.confirmationActions}>
        {isPending ? (
          <>
            <button
              className={styles.confirmButton}
              onClick={() => onConfirm(action, true)}
            >
              <PiCheck size={14} />
              Confirm
            </button>
            <button
              className={styles.rejectButton}
              onClick={() => onConfirm(action, false)}
            >
              <PiX size={14} />
              Reject
            </button>
          </>
        ) : (
          <span
            className={
              action.status === "confirmed"
                ? styles.statusConfirmed
                : styles.statusRejected
            }
          >
            {action.status === "confirmed" ? "Confirmed" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  );
};

export default AIChatConfirmation;
