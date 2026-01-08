import React, { useState } from "react";
import { Box, Flex, Text, Card, Badge, Heading } from "@radix-ui/themes";
import { FaHistory, FaUndo } from "react-icons/fa";
import { date } from "shared/dates";
import { ApprovalFlowInterface } from "@/types/approval-flow";
import { useRevisionHistory } from "@/hooks/useApprovalFlows";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import ApprovalFlowDiff from "./ApprovalFlowDiff";

interface RevisionHistoryProps {
  entityType: "metric" | "fact-metric" | "fact-table" | "experiment";
  entityId: string;
  currentState: Record<string, unknown>;
  onRevert?: () => void;
}

const RevisionHistory: React.FC<RevisionHistoryProps> = ({
  entityType,
  entityId,
  currentState,
  onRevert,
}) => {
  const { apiCall } = useAuth();
  const { revisions, isLoading, mutate } = useRevisionHistory(
    entityType,
    entityId
  );
  const [selectedRevision, setSelectedRevision] =
    useState<ApprovalFlowInterface | null>(null);
  const [reverting, setReverting] = useState(false);
  const [showConfirmRevert, setShowConfirmRevert] = useState(false);

  const handleRevert = async (revisionId: string) => {
    setReverting(true);
    try {
      await apiCall(`/approval-flow/${revisionId}/revert`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      mutate();
      onRevert?.();
      setSelectedRevision(null);
      setShowConfirmRevert(false);
    } catch (error) {
      console.error("Failed to create revert approval flow:", error);
    } finally {
      setReverting(false);
    }
  };

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (revisions.length === 0) {
    return (
      <Box
        p="4"
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-2)",
          textAlign: "center",
        }}
      >
        <FaHistory
          size={24}
          style={{ color: "var(--gray-8)", marginBottom: 8 }}
        />
        <Text size="2" color="gray" as="p">
          No revision history yet.
        </Text>
        <Text size="1" color="gray" as="p">
          Merged approval flows will appear here.
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="3" mb="3" weight="medium">
        <FaHistory style={{ marginRight: 8 }} />
        Revision History
      </Heading>

      <Flex direction="column" gap="2">
        {revisions.map((revision) => (
          <Card
            key={revision.id}
            size="2"
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedRevision(revision)}
            className="hover-highlight"
          >
            <Flex justify="between" align="start" gap="3">
              <Box style={{ flex: 1 }}>
                <Flex align="center" gap="2" mb="1">
                  <Text weight="medium" size="2">
                    {revision.title}
                  </Text>
                  <Badge color="purple" size="1" radius="full">
                    Merged
                  </Badge>
                </Flex>
                {revision.description && (
                  <Text size="1" color="gray">
                    {revision.description}
                  </Text>
                )}
                {revision.mergedAt && (
                  <Text size="1" color="gray" mt="1" as="p">
                    Merged by {revision.mergedBy} on {date(revision.mergedAt)}
                  </Text>
                )}
              </Box>
              <Button
                variant="soft"
                size="sm"
                onClick={() => {
                  setSelectedRevision(revision);
                  setShowConfirmRevert(true);
                }}
              >
                <FaUndo size={10} style={{ marginRight: 4 }} />
                Revert
              </Button>
            </Flex>
          </Card>
        ))}
      </Flex>

      {/* Revision Details Modal */}
      {selectedRevision && !showConfirmRevert && (
        <Modal
          open={true}
          close={() => setSelectedRevision(null)}
          size="lg"
          header={
            <Flex align="center" gap="2">
              <Text size="5" weight="bold">
                {selectedRevision.title}
              </Text>
            </Flex>
          }
          trackingEventModalType="revision-details"
          cta="Revert to this version"
          submit={() => {
            setShowConfirmRevert(true);
          }}
          secondaryCTA={
            <Button variant="ghost" onClick={() => setSelectedRevision(null)}>
              Close
            </Button>
          }
        >
          <Box>
            {selectedRevision.description && (
              <Box mb="4">
                <Text color="gray" size="2">
                  {selectedRevision.description}
                </Text>
              </Box>
            )}

            {selectedRevision.mergedAt && (
              <Box mb="4">
                <Text size="2" color="gray">
                  Merged by {selectedRevision.mergedBy} on{" "}
                  {date(selectedRevision.mergedAt)}
                </Text>
              </Box>
            )}

            <Heading size="4" mb="3" weight="medium">
              Changes in this revision
            </Heading>
            <ApprovalFlowDiff
              currentState={selectedRevision.originalEntity}
              proposedChanges={selectedRevision.proposedChanges}
            />
          </Box>
        </Modal>
      )}

      {/* Confirm Revert Modal */}
      {selectedRevision && showConfirmRevert && (
        <Modal
          open={true}
          close={() => {
            setShowConfirmRevert(false);
            setSelectedRevision(null);
          }}
          size="md"
          header="Confirm Revert"
          trackingEventModalType="confirm-revert"
          cta={reverting ? "Creating..." : "Create Revert Request"}
          submit={async () => {
            await handleRevert(selectedRevision.id);
          }}
          ctaEnabled={!reverting}
          secondaryCTA={
            <Button
              variant="ghost"
              onClick={() => {
                setShowConfirmRevert(false);
                setSelectedRevision(null);
              }}
            >
              Cancel
            </Button>
          }
        >
          <Box>
            <Text size="2" as="p" mb="3">
              This will create a new approval flow to revert to the state before{" "}
              <strong>{selectedRevision.title}</strong> was merged.
            </Text>

            <Box
              p="3"
              style={{
                backgroundColor: "var(--amber-2)",
                border: "1px solid var(--amber-6)",
                borderRadius: "var(--radius-2)",
              }}
            >
              <Text size="2" color="amber">
                The revert will need to be approved before being applied.
              </Text>
            </Box>
          </Box>
        </Modal>
      )}
    </Box>
  );
};

export default RevisionHistory;
