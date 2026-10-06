import { ReactNode, useEffect, useState } from "react";
import styles from "./Collapse.module.scss";

// A section that opens and closes with a smooth height change (set in
// review): the Analysis Plan's Advanced, and the rail's To Do and Data
// groups. The contents stay mounted when closed (hidden, out of the tab
// order), so nothing in them is lost. Any space between the section and
// what's above it belongs inside, on the children, so closed takes no room.
// See Collapse.module.scss.
export default function Collapse({
  open,
  id,
  children,
}: {
  open: boolean;
  // For the toggle's aria-controls.
  id?: string;
  children: ReactNode;
}) {
  // Whether it has finished opening: until then the contents are clipped,
  // so they don't spill out while the height grows.
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);
  return (
    <div
      id={id}
      className={styles.collapse}
      data-open={open ? "true" : "false"}
      data-settled={open && settled ? "true" : "false"}
      onTransitionEnd={(e) => {
        if (
          e.target === e.currentTarget &&
          e.propertyName === "grid-template-rows" &&
          open
        ) {
          setSettled(true);
        }
      }}
    >
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
