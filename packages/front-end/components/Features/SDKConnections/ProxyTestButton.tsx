import { useEffect, useState } from "react";
import { ProxyTestResult } from "shared/types/sdk-connection";
import { BsArrowRepeat } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Code from "@/components/SyntaxHighlighting/Code";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

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
        <Modal.Root
          open={true}
          onOpenChange={(open) => {
            if (!open) setProxyTestResult(null);
          }}
          trackingEventModalType=""
        >
          <Modal.Header>
            <Modal.Title>Proxy Status</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {proxyTestResult.error ? (
              <div>
                {proxyTestResult.url && (
                  <Text as="p" mb="2">
                    GET <code>{proxyTestResult.url}</code>
                  </Text>
                )}
                {proxyTestResult.status > 0 && (
                  <Text as="p" mb="2">
                    Status Code: <code>{proxyTestResult.status}</code>
                  </Text>
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
                <Callout status="error">Error: {proxyTestResult.error}</Callout>
              </div>
            ) : (
              <Callout status="success">
                Successfully Connected. Proxy Server running version{" "}
                <strong>{proxyTestResult.version}</strong>.
              </Callout>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Modal.Close>
          </Modal.Footer>
        </Modal.Root>
      )}
      {showButton && (
        <Button
          variant="ghost"
          size="sm"
          title="Test connection"
          icon={<BsArrowRepeat />}
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
          Re-check
        </Button>
      )}
    </>
  );
}
