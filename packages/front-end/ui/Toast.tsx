import { Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { ReactNode } from "react";
import { PiX } from "react-icons/pi";
import Callout from "./Callout";
import Button from "./Button";
import { Status } from "./HelperText";
import styles from "./Toast.module.scss";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

/**
 * A small, fixed-position toast that floats in the bottom-right corner (above
 * the in-app help button). Presentational only — callers control when it's
 * mounted. For app-wide background-refresh failures, see
 * `services/BackgroundRefreshError`.
 */
export default function Toast({
  status,
  children,
  action,
  onDismiss,
}: {
  status: Status;
  children: ReactNode;
  action?: ToastAction;
  onDismiss?: () => void;
}) {
  return (
    // Callout owns the single ARIA live region; keep the wrapper plain to avoid double-announcing.
    <div className={styles.toast}>
      <Callout
        status={status}
        size="sm"
        role={status === "error" ? "alert" : "status"}
        action={
          action || onDismiss ? (
            <Flex align="center" gap="2">
              {action ? (
                <Button
                  color="inherit"
                  variant="soft"
                  size="sm"
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ) : null}
              {onDismiss ? (
                <Tooltip content="Dismiss">
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    onClick={onDismiss}
                    aria-label="Dismiss"
                  >
                    <PiX />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Flex>
          ) : undefined
        }
      >
        {children}
      </Callout>
    </div>
  );
}
