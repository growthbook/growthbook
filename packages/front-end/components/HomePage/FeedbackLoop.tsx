import { FC } from "react";
import styles from "./FeedbackLoop.module.scss";
import clsx from "clsx";
import Link from "next/link";

const FeedbackLoop: FC = () => {
  return (
    <div
      className={clsx(
        "container-fluid text-center position-relative",
        styles.container
      )}
    >
      <img src="/feedback-loop.png" className={styles.image} width="50%" />
      <Link href="/ideas">
        <a className={clsx(styles.text, styles.top, styles.left)}>
          Collect Ideas
        </a>
      </Link>
      <Link href="/experiments">
        <a className={clsx(styles.text, styles.top, styles.right)}>
          Run Experiments
        </a>
      </Link>
      <Link href="/insights">
        <a className={clsx(styles.text, styles.bottom, styles.right)}>
          Gain Insights
        </a>
      </Link>
      <Link href="/share">
        <a className={clsx(styles.text, styles.bottom, styles.left)}>
          Share Results
        </a>
      </Link>
      <Link href="/metrics">
        <a className={clsx(styles.center)}>Metrics</a>
      </Link>
    </div>
  );
};
export default FeedbackLoop;
