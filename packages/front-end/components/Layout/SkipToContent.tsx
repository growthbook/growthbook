import styles from "./SkipToContent.module.scss";

export const MAIN_CONTENT_ID = "main-content";

export default function SkipToContent() {
  return (
    <a href={`#${MAIN_CONTENT_ID}`} className={styles.skipLink}>
      Skip to main content
    </a>
  );
}
