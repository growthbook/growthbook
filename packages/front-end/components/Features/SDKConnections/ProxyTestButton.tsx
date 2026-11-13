import { useEffect, useState } from "react";
import { ProxyTestResult } from "shared/types/sdk-connection";
import { PiArrowsClockwise } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

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
        <Tooltip content="Test connection">
          <Button
            variant="ghost"
            size="sm"
            icon={<PiArrowsClockwise />}
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
        </Tooltip>
      )}
    </>
  );
}
