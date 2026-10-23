import { PiCaretUp, PiCaretUpFill } from "react-icons/pi";
import clsx from "clsx";
import styles from "./ExperimentIdeas.module.scss";

export default function VotePill({
  count,
  voted,
  onToggle,
}: {
  count: number;
  voted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(styles.votePill, voted && styles.votePillActive)}
      aria-pressed={voted}
      aria-label={voted ? "Remove upvote" : "Upvote"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      {voted ? <PiCaretUpFill size={11} /> : <PiCaretUp size={11} />}
      {count}
    </button>
  );
}
