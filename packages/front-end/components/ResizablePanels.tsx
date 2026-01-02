import clsx from "clsx";
import { PiDotsSix } from "react-icons/pi";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle as LibResizeHandle,
  PanelResizeHandleProps as LibResizeHandleProps,
} from "react-resizable-panels";
import styles from "./ResizablePanels.module.scss";

function PanelResizeHandle({
  children,
  className,
  ...props
}: LibResizeHandleProps) {
  return (
    <LibResizeHandle
      className={clsx(styles["resize-handle"], className)}
      {...props}
    >
      {children || <PiDotsSix className={styles["resize-handle-icon"]} />}
    </LibResizeHandle>
  );
}

export { Panel, PanelGroup, PanelResizeHandle };
