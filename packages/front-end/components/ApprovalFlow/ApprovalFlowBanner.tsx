import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ApprovalFlow } from "shared/enterprise";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Modal from "@/components/Modal";

interface ApprovalFlowBannerProps {
  approvalFlow: ApprovalFlow;
  onDiscard: (flowId: string) => Promise<void>;
  onPublish: (flowId: string) => Promise<void>;
  canPublish: boolean;
  canDiscard: boolean;
}

const STATUS_BANNER_CONFIG: Record<
  string,
  { status: "info" | "success" | "warning"; text: string }
> = {
  "pending-review": {
    status: "info",
    text: "Change is pending review.",
  },
  approved: {
    status: "success",
    text: "Approved change is ready to publish. Changes have not yet been applied.",
  },
  "changes-requested": {
    status: "warning",
    text: "Changes have been requested on this proposal.",
  },
};

export default function ApprovalFlowBanner({
  approvalFlow,
  onDiscard,
  onPublish,
  canPublish,
  canDiscard,
}: ApprovalFlowBannerProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = STATUS_BANNER_CONFIG[approvalFlow.status];
  if (!config) return null;

  return (
    <>
      {confirmDiscard && (
        <Modal
          trackingEventModalType=""
          header="Discard Draft"
          close={() => setConfirmDiscard(false)}
          open={true}
          cta="Discard"
          submitColor="danger"
          submit={async () => {
            try {
              await onDiscard(approvalFlow.id);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Failed to discard draft",
              );
              throw e;
            }
          }}
        >
          Are you sure you want to discard this proposed change? This action
          cannot be undone.
        </Modal>
      )}
      {confirmPublish && (
        <Modal
          trackingEventModalType=""
          header="Publish Changes"
          close={() => setConfirmPublish(false)}
          open={true}
          cta="Publish"
          submitColor="primary"
          submit={async () => {
            try {
              await onPublish(approvalFlow.id);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Failed to publish changes",
              );
              throw e;
            }
          }}
        >
          These changes will go live immediately. Are you sure you want to
          publish?
        </Modal>
      )}
      <Callout status={config.status} mb="4" contentsAs="div">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <span>
            {config.text}
            {error && (
              <span style={{ color: "var(--red-9)", marginLeft: 8 }}>
                {error}
              </span>
            )}
          </span>
          <Flex gap="2" align="center">
            {canDiscard && (
              <Link onClick={() => setConfirmDiscard(true)}>Discard draft</Link>
            )}
            {approvalFlow.status === "approved" && canPublish && (
              <Button
                variant="solid"
                color="violet"
                size="sm"
                onClick={() => setConfirmPublish(true)}
              >
                Publish Changes
              </Button>
            )}
          </Flex>
        </Flex>
      </Callout>
    </>
  );
}
