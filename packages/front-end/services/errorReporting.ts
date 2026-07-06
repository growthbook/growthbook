import {
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
} from "@sentry/nextjs";
import {
  getGrowthBookBuild,
  isSentryEnabled,
  isTelemetryEnabled,
} from "@/services/env";
import {
  captureError,
  type GrowthBookErrorEventProps,
} from "@/services/growthbook/plugins";
import { growthbook } from "@/services/utils";

function growthBookErrorProps(
  props?: GrowthBookErrorEventProps,
): GrowthBookErrorEventProps {
  const release = getGrowthBookBuild().sha || undefined;
  return release ? { release, ...props } : props || {};
}

/** Report an exception to Sentry (when enabled) and GrowthBook error tracking (when enabled). */
export function reportException(
  error: unknown,
  props?: GrowthBookErrorEventProps,
): void {
  if (isSentryEnabled()) {
    sentryCaptureException(error);
  }
  if (!isTelemetryEnabled()) return;

  void captureError({
    gb: growthbook,
    error,
    props: growthBookErrorProps(props),
  });
}

/** Report a message to Sentry (when enabled) and GrowthBook error tracking (when enabled). */
export function reportMessage(
  message: string,
  props?: GrowthBookErrorEventProps,
): void {
  if (isSentryEnabled()) {
    sentryCaptureMessage(message);
  }
  if (!isTelemetryEnabled()) return;

  void captureError({
    gb: growthbook,
    error: new Error(message),
    props: growthBookErrorProps({
      errorType: "message",
      ...props,
    }),
  });
}
