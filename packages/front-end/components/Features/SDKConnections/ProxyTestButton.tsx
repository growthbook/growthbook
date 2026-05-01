import { useEffect, useState } from "react";
import { ProxyTestResult } from "shared/types/sdk-connection";
import { BsArrowRepeat } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Button from "@/components/Button";
import Code from "@/components/SyntaxHighlighting/Code";

export default function ProxyTestButton({
  host,
  id,
  mutate,
  showButton,
}: {
  host: string;
  id: string;
  showButton: boolean;
  mutate: () => void;
}) {
  const [proxyTestResult, setProxyTestResult] =
    useState<null | ProxyTestResult>(null);

  const { apiCall } = useAuth();

  useEffect(() => {
    setProxyTestResult(null);
  }, [host]);

  return (
    <>
      {proxyTestResult && (
        <DialogLayout
          trackingEventModalType=""
          header="Proxy Status"
          open={true}
          close={() => setProxyTestResult(null)}
        >
          {proxyTestResult.error ? (
            <div>
              {proxyTestResult.url && (
                <div className="mb-2">
                  GET <code>{proxyTestResult.url}</code>
                </div>
              )}
              {proxyTestResult.status > 0 && (
                <div className="mb-2">
                  Status Code: <code>{proxyTestResult.status}</code>
                </div>
              )}
              {proxyTestResult.body && (
                <Code
                  language={
                    proxyTestResult.body.trim().substring(0, 1) === "<"
                      ? "html"
                      : proxyTestResult.body.trim().substring(0, 1) === "{"
                        ? "json"
                        : "none"
                  }
                  code={proxyTestResult.body}
                  filename="response.body"
                  expandable={true}
                />
              )}
              <div className="alert alert-danger">
                Error: {proxyTestResult.error}
              </div>
            </div>
          ) : (
            <div className="alert alert-success">
              Successfully Connected. Proxy Server running version{" "}
              <strong>{proxyTestResult.version}</strong>.
            </div>
          )}
        </DialogLayout>
      )}
      {showButton && (
        <Button
          color="link"
          className="btn-sm"
          title="Test connection"
          onClick={async () => {
            const res = await apiCall<{
              result: ProxyTestResult;
            }>(`/sdk-connections/${id}/check-proxy`, {
              method: "POST",
            });
            mutate();

            if (res.result) {
              setProxyTestResult(res.result);
            }
          }}
        >
          <BsArrowRepeat /> re-check
        </Button>
      )}
    </>
  );
}
