import { useEffect, useState } from "react";
import { MdNetworkCheck } from "react-icons/md";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Button from "@/components/Button";
import Code from "@/components/SyntaxHighlighting/Code";

export default function ProxyTestButton({
  host,
  id,
  mutate,
}: {
  host: string;
  id: string;
  mutate: () => void;
}) {
  const [proxyTestResult, setProxyTestResult] = useState<null | {
    status: number;
    body: string;
    error: string;
    version: string;
  }>(null);

  const { apiCall } = useAuth();

  useEffect(() => {
    setProxyTestResult(null);
  }, [host]);

  return (
    <>
      {proxyTestResult && (
        <Modal
          header="Proxy Status"
          open={true}
          close={() => setProxyTestResult(null)}
          closeCta="Close"
        >
          {proxyTestResult.error ? (
            <div>
              {proxyTestResult.status > 0 && (
                <p>
                  Received a <strong>{proxyTestResult.status}</strong> status
                  code.
                </p>
              )}
              <div className="alert alert-danger">{proxyTestResult.error}</div>
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
            </div>
          ) : (
            <div className="alert alert-success">
              Successfully Connected. Proxy Server running version{" "}
              <strong>{proxyTestResult.version}</strong>.
            </div>
          )}
        </Modal>
      )}
      <Button
        color="outline-primary"
        className="btn-sm"
        title="Test connection"
        onClick={async () => {
          const res = await apiCall<{
            result: {
              status: number;
              body: string;
              error: string;
              version: string;
            };
          }>(`/sdk-connections/${id}/check-proxy`, {
            method: "POST",
          });
          mutate();

          if (res.result) {
            setProxyTestResult(res.result);
          }
        }}
      >
        <MdNetworkCheck /> Test Connection
      </Button>
    </>
  );
}
