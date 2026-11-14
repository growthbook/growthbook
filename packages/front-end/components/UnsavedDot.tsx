import styles from "./UnsavedDot.module.scss";

// Marks a field with an unsaved change, left of its label. Its parent is
// positioned and wraps the label.
export default function UnsavedDot({
  align = "center",
}: {
  // `firstLine` centres it on a checkbox's first line.
  align?: "center" | "firstLine";
}) {
  return (
    <span
      className={align === "firstLine" ? styles.checkDot : styles.fieldDot}
      role="img"
      aria-label="Unsaved"
    />
  );
}
