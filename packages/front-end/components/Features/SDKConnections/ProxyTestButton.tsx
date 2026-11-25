import { useEffect, useState } from "react";
import { ProxyTestResult } from "shared/types/sdk-connection";
import { PiArrowsClockwise } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
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
  const { t } = useLingui();
  const [proxyTestResult, setProxyTestResult] =
    useState<null | ProxyTestResult>(null);

  const { apiCall } = useAuth();

  const proxyStatus = proxyTestResult?.status;
  const proxyError = proxyTestResult?.error;
  const proxyVersion = proxyTestResult?.version;

  useEffect(() => {
    setProxyTestResult(null);
  }, [host]);

  return (
    <>
      {proxyTestResult && (
        <ModalStandard
          open={true}
          close={() => setProxyTestResult(null)}
          header={t`Proxy Status`}
          closeCta={t`Close`}
          trackingEventModalType=""
        >
          {proxyTestResult.error ? (
            <div>
              {proxyTestResult.url && (
                <Text as="p" mb="2">
                  GET <code>{proxyTestResult.url}</code>
                </Text>
              )}
              {proxyTestResult.status > 0 && (
                <Text as="p" mb="2">
                  <Trans>
                    Status Code: <code>{proxyStatus}</code>
                  </Trans>
                </Text>
              )}
              <Callout status="error">
                <Trans>Error: {proxyError}</Trans>
              </Callout>
            </div>
          ) : (
            <Callout status="success">
              <Trans>
                Successfully Connected. Proxy Server running version{" "}
                <strong>{proxyVersion}</strong>.
              </Trans>
            </Callout>
          )}
        </ModalStandard>
      )}
      {showButton && (
        <Tooltip content={t`Test connection`}>
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
            <Trans>Re-check</Trans>
          </Button>
        </Tooltip>
      )}
    </>
  );
}
