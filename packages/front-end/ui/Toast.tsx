import { Box, Flex, IconButton, Tooltip } from "@radix-ui/themes";
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
    <div className={styles.toast} role="status" aria-live="polite">
      <Callout status={status} size="sm" variant="surface" contentsAs="div">
        <Flex align="center" gap="3">
          <Box flexGrow="1">{children}</Box>
          {action ? (
            <Button size="xs" variant="soft" onClick={action.onClick}>
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
                style={{ flexShrink: 0, marginTop: 0 }}
              >
                <PiX />
              </IconButton>
            </Tooltip>
          ) : null}
        </Flex>
      </Callout>
    </div>
  );
}
