import React, { useMemo, useState } from "react";
import { GrowthBook } from "@growthbook/growthbook";
import { growthbookTrackingPlugin } from "@growthbook/growthbook/plugins";
import { GrowthBookProvider } from "@growthbook/growthbook-react";
import { captureError } from "shared/error-tracking";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import PageHead from "@/components/Layout/PageHead";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { GrowthBookErrorBoundary } from "@/services/growthbook/plugins";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

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

  const { data: sdkData } = useApi<{ connections: SDKConnectionInterface[] }>(
    "/sdk-connections",
  );
  const { data: configData } = useApi<{ ingestorHost: string }>(
    "/error-tracking-test/config",
  );

  const connections = sdkData?.connections ?? [];
  const [clientKey, setClientKey] = useState("");
  const activeClientKey = clientKey || connections[0]?.key || "";

  const [lastResult, setLastResult] = useState<{
    label: string;
    ok: boolean;
    detail: string;
  } | null>(null);
  const [crashCount, setCrashCount] = useState(0);

  // Own tracking plugin only (no growthbookErrorTrackingPlugin), so
  // reporting is limited to the explicit captureError calls below instead
  // of also installing page-wide window.onerror/unhandledrejection
  // listeners that would double-report unrelated bugs on this page.
  const testClient = useMemo(() => {
    if (!activeClientKey || !configData?.ingestorHost) return null;
    return new GrowthBook({
      clientKey: activeClientKey,
      plugins: [
        growthbookTrackingPlugin({ ingestorHost: configData.ingestorHost }),
      ],
    });
  }, [activeClientKey, configData?.ingestorHost]);

  const report = async (label: string, errorType: string, handled: boolean) => {
    if (!testClient) return;
    try {
      throw new Error(`[Error Tracking Test] ${label}`);
    } catch (error) {
      await captureError({
        gb: testClient,
        error,
        props: { errorType, handled, transaction: "error-tracking-test-page" },
      });
      setLastResult({ label, ok: true, detail: "Sent to " + activeClientKey });
    }
  };

  const reportRejection = async (label: string, errorType: string) => {
    if (!testClient) return;
    try {
      await Promise.reject(new Error(`[Error Tracking Test] ${label}`));
    } catch (error) {
      await captureError({
        gb: testClient,
        error,
        props: {
          errorType,
          handled: false,
          transaction: "error-tracking-test-page",
        },
      });
      setLastResult({ label, ok: true, detail: "Sent to " + activeClientKey });
    }
  };

  const triggerBackend = async (scenario: BackendScenario, label: string) => {
    try {
      await apiCall("/error-tracking-test/backend", {
        method: "POST",
        body: JSON.stringify({ clientKey: activeClientKey, scenario }),
      });
      setLastResult({ label, ok: true, detail: "Sent to " + activeClientKey });
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
        Internal tool for generating synthetic errors to verify the error
        tracking pipeline end to end. Not linked from the main nav.
      </Callout>

      <div className="my-3" style={{ maxWidth: 400 }}>
        <SelectField
          label="SDK Connection"
          options={connections.map((c) => ({
            value: c.key,
            label: `${c.name} (${c.key.slice(0, 8)}…)`,
          }))}
          value={activeClientKey}
          onChange={setClientKey}
        />
      </div>

      {activeClientKey && (
        <div className="mb-3">
          <Link
            href={`/error-tracking?clientKey=${encodeURIComponent(activeClientKey)}`}
          >
            View issues for this connection
          </Link>
        </div>
      )}

      {lastResult && (
        <Callout status={lastResult.ok ? "success" : "error"} mb="3">
          <strong>{lastResult.label}:</strong> {lastResult.detail}
        </Callout>
      )}

      <h2 className="h4 mt-4">Front-end errors</h2>
      <div className="d-flex flex-wrap" style={{ gap: 8 }}>
        <Button
          disabled={!testClient}
          onClick={() => setCrashCount((c) => c + 1)}
        >
          Uncaught render error (React)
        </Button>
        <Button
          disabled={!testClient}
          onClick={() =>
            report("Front-end uncaught exception", "test-fe-uncaught", false)
          }
        >
          Uncaught exception
        </Button>
        <Button
          disabled={!testClient}
          onClick={() =>
            reportRejection(
              "Front-end unhandled promise rejection",
              "test-fe-unhandledrejection",
            )
          }
        >
          Unhandled promise rejection
        </Button>
        <Button
          disabled={!testClient}
          onClick={() =>
            report("Front-end handled error", "test-fe-handled", true)
          }
        >
          Manually captured (handled) error
        </Button>
      </div>

      {crashCount > 0 && testClient && (
        <div className="mt-3">
          <GrowthBookProvider growthbook={testClient}>
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
          </GrowthBookProvider>
        </div>
      )}

      <h2 className="h4 mt-4">Back-end errors</h2>
      <div className="d-flex flex-wrap" style={{ gap: 8 }}>
        <Button
          disabled={!activeClientKey}
          onClick={() => triggerBackend("uncaught", "Backend uncaught error")}
        >
          Uncaught exception
        </Button>
        <Button
          disabled={!activeClientKey}
          onClick={() =>
            triggerBackend("async-rejection", "Backend async rejection")
          }
        >
          Async rejection
        </Button>
        <Button
          disabled={!activeClientKey}
          onClick={() => triggerBackend("logged", "Backend logged error")}
        >
          logger.error (handled)
        </Button>
        <Button
          disabled={!activeClientKey}
          onClick={() => triggerBackend("handled", "Backend handled error")}
        >
          Manually captured (handled) error
        </Button>
      </div>
    </div>
  );
}
