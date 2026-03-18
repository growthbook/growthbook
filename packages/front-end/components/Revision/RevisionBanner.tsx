import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { Revision } from "shared/enterprise";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Modal from "@/components/Modal";

interface RevisionBannerProps {
  revision: Revision;
  onDiscard: (revisionId: string) => Promise<void>;
  onPublish: (revisionId: string) => Promise<void>;
  onReopen?: (revisionId: string) => Promise<void>;
  canPublish: boolean;
  canDiscard: boolean;
  canReopen?: boolean;
}

const STATUS_BANNER_CONFIG: Record<
  string,
  { status: "info" | "success" | "warning" | "error"; text: string }
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
  closed: {
    status: "error",
    text: "This revision has been closed and is in read-only mode.",
  },
  merged: {
    status: "success",
    text: "This revision has been merged and published. Changes have been applied.",
  },
};

export default function RevisionBanner({
  revision,
  onDiscard,
  onPublish,
  onReopen,
  canPublish,
  canDiscard,
  canReopen,
}: RevisionBannerProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = STATUS_BANNER_CONFIG[revision.status];
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
              await onDiscard(revision.id);
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
              await onPublish(revision.id);
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
      {confirmReopen && onReopen && (
        <Modal
          trackingEventModalType=""
          header="Reopen Revision"
          close={() => setConfirmReopen(false)}
          open={true}
          cta="Reopen"
          submitColor="primary"
          submit={async () => {
            try {
              await onReopen(revision.id);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Failed to reopen revision",
              );
              throw e;
            }
          }}
        >
          This will reopen the revision and allow you to make further changes.
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
            {canDiscard &&
              revision.status !== "closed" &&
              revision.status !== "merged" && (
                <Link onClick={() => setConfirmDiscard(true)}>
                  Discard draft
                </Link>
              )}
            {revision.status === "approved" && canPublish && (
              <Button
                variant="solid"
                color="violet"
                size="sm"
                onClick={() => setConfirmPublish(true)}
              >
                Publish Changes
              </Button>
            )}
            {revision.status === "closed" && canReopen && onReopen && (
              <Button
                variant="solid"
                color="violet"
                size="sm"
                onClick={() => setConfirmReopen(true)}
              >
                Reopen
              </Button>
            )}
          </Flex>
        </Flex>
      </Callout>
    </>
  );
}
