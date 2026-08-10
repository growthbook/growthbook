import React, { useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { captureError } from "shared/error-tracking";
import { AppFeatures } from "shared/types/app-features";
import PageHead from "@/components/Layout/PageHead";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { GrowthBookErrorBoundary } from "@/services/growthbook/plugins";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";
import { getGrowthBookBuild } from "@/services/env";

type BackendScenario = "uncaught" | "async-rejection" | "logged" | "handled";

/** Throws while rendering so GrowthBookErrorBoundary catches it. */
function Crasher(): React.ReactElement {
  throw new Error("[Error Tracking Test] Front-end React render error");
}

export default function ErrorTrackingTestPage(): React.ReactElement {
  const { ready: featureReady, shouldRender } = useFeatureDisabledRedirect(
    "error-tracking-test-page",
  );
  const { apiCall } = useAuth();
  const growthbook = useGrowthBook<AppFeatures>();

  const [lastResult, setLastResult] = useState<{
    label: string;
    ok: boolean;
    detail: string;
  } | null>(null);
  const [crashCount, setCrashCount] = useState(0);

  // Match the release value real captures use (see errorReporting.ts) so an
  // uploaded source map for this build will actually symbolicate these.
  const release = getGrowthBookBuild().sha || undefined;

  // "Handled" errors are reported explicitly, exercising captureError's
  // manual-capture entry point on the app's own GrowthBook instance.
  const reportHandled = async (label: string, errorType: string) => {
    if (!growthbook) return;
    try {
      throw new Error(`[Error Tracking Test] ${label}`);
    } catch (error) {
      await captureError({
        gb: growthbook,
        error,
        props: {
          errorType,
          handled: true,
          release,
          transaction: "error-tracking-test-page",
        },
      });
      setLastResult({
        label,
        ok: true,
        detail: "Reported via GrowthBook's own internal client",
      });
    }
  };

  // "Uncaught"/"unhandled rejection" genuinely throw/reject so the app's
  // already-installed growthbookErrorTrackingPlugin (window.onerror /
  // unhandledrejection listeners, see pages/_app.tsx) captures them the
  // same way it would a real bug — no separate capture call needed here.
  //
  // The throw is deferred via setTimeout rather than thrown directly in the
  // click handler: React's dev-mode event dispatch wraps synchronous handler
  // exceptions for nicer devtools attribution, which can keep them from
  // reaching window.onerror as a normal global error. A setTimeout callback
  // runs as its own top-level task outside that wrapping, so it reproduces
  // a real uncaught exception the same way in dev and production.
  const triggerUncaught = (label: string) => {
    setLastResult({
      label,
      ok: true,
      detail: "Thrown — captured automatically by the error tracking plugin",
    });
    setTimeout(() => {
      throw new Error(`[Error Tracking Test] ${label}`);
    }, 0);
  };

  const triggerUnhandledRejection = (label: string) => {
    setLastResult({
      label,
      ok: true,
      detail: "Rejected — captured automatically by the error tracking plugin",
    });
    void Promise.reject(new Error(`[Error Tracking Test] ${label}`));
  };

  const triggerBackend = async (scenario: BackendScenario, label: string) => {
    try {
      await apiCall("/error-tracking-test/backend", {
        method: "POST",
        body: JSON.stringify({ scenario }),
      });
      setLastResult({
        label,
        ok: true,
        detail: "Reported via GrowthBook's own internal backend client",
      });
    } catch (e) {
      // "uncaught" and "async-rejection" scenarios intentionally fail the
      // request server-side; the error was still reported before that happened.
      setLastResult({
        label,
        ok: true,
        detail: `Backend responded with an error as expected (${e instanceof Error ? e.message : String(e)})`,
      });
    }
  };

  if (!featureReady || !shouldRender) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Error Tracking", href: "/error-tracking" },
          { display: "Test", href: "#" },
        ]}
      />
      <h1>Error Tracking Test Page</h1>
      <Callout status="info">
        Internal tool for exercising GrowthBook&apos;s own error tracking setup
        (the internal telemetry client used to report on this app itself, not a
        customer SDK connection). Not linked from the main nav.
      </Callout>

      {lastResult && (
        <Callout status={lastResult.ok ? "success" : "error"} mb="3">
          <strong>{lastResult.label}:</strong> {lastResult.detail}
        </Callout>
      )}

      <Box mt="4">
        <h2 className="h4">Front-end errors</h2>
      </Box>
      <Flex wrap="wrap" gap="2">
        <Button onClick={() => setCrashCount((c) => c + 1)}>
          Uncaught render error (React)
        </Button>
        <Button onClick={() => triggerUncaught("Front-end uncaught exception")}>
          Uncaught exception
        </Button>
        <Button
          onClick={() =>
            triggerUnhandledRejection("Front-end unhandled promise rejection")
          }
        >
          Unhandled promise rejection
        </Button>
        <Button
          disabled={!growthbook}
          onClick={() =>
            reportHandled("Front-end handled error", "test-fe-handled")
          }
        >
          Manually captured (handled) error
        </Button>
      </Flex>

      {crashCount > 0 && (
        <Box mt="3">
          <GrowthBookErrorBoundary
            key={crashCount}
            fallback={
              <Callout status="error">
                Caught by GrowthBookErrorBoundary and reported.
              </Callout>
            }
          >
            <Crasher />
          </GrowthBookErrorBoundary>
        </Box>
      )}

      <Box mt="4">
        <h2 className="h4">Back-end errors</h2>
      </Box>
      <Flex wrap="wrap" gap="2">
        <Button
          onClick={() => triggerBackend("uncaught", "Backend uncaught error")}
        >
          Uncaught exception
        </Button>
        <Button
          onClick={() =>
            triggerBackend("async-rejection", "Backend async rejection")
          }
        >
          Async rejection
        </Button>
        <Button
          onClick={() => triggerBackend("logged", "Backend logged error")}
        >
          logger.error (handled)
        </Button>
        <Button
          onClick={() => triggerBackend("handled", "Backend handled error")}
        >
          Manually captured (handled) error
        </Button>
      </Flex>
    </div>
  );
}
