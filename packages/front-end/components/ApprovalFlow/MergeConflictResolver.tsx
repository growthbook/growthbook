import React, { useState, useEffect } from "react";
import {
  Box,
  Flex,
  Text,
  Card,
  Badge,
  Heading,
  RadioGroup,
} from "@radix-ui/themes";
import { FaExclamationTriangle, FaCheck } from "react-icons/fa";
import { Conflict, MergeResult } from "shared/util";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Modal from "@/components/Modal";
import Code from "@/components/SyntaxHighlighting/Code";
import Callout from "@/ui/Callout";

interface MergeConflictResolverProps {
  approvalFlowId: string;
  mergeResult: MergeResult;
  currentState: Record<string, unknown>;
  onResolved: () => void;
  onCancel: () => void;
}

type Resolution = "proposed" | "current";

const MergeConflictResolver: React.FC<MergeConflictResolverProps> = ({
  approvalFlowId,
  mergeResult,
  currentState,
  onResolved,
  onCancel,
}) => {
  const { apiCall } = useAuth();
  const [resolving, setResolving] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {}
  );

  // Initialize resolutions - default to proposed values
  useEffect(() => {
    const initial: Record<string, Resolution> = {};
    for (const conflict of mergeResult.conflicts) {
      initial[conflict.field] = "proposed";
    }
    setResolutions(initial);
  }, [mergeResult.conflicts]);

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value, null, 2);
    }
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const handleResolve = async () => {
    setResolving(true);
    try {
      // Build resolved changes from selections
      const resolvedChanges: Record<string, unknown> = {
        ...mergeResult.mergedChanges,
      };

      // Apply conflict resolutions
      for (const conflict of mergeResult.conflicts) {
        if (resolutions[conflict.field] === "current") {
          resolvedChanges[conflict.field] = conflict.liveValue;
        } else {
          resolvedChanges[conflict.field] = conflict.proposedValue;
        }
      }

      await apiCall(`/approval-flow/${approvalFlowId}/resolve-conflicts`, {
        method: "POST",
        body: JSON.stringify({ resolvedChanges }),
      });

      onResolved();
    } catch (error) {
      console.error("Failed to resolve conflicts:", error);
    } finally {
      setResolving(false);
    }
  };

  const allResolved = mergeResult.conflicts.every(
    (c) => resolutions[c.field] !== undefined
  );

  return (
    <Modal
      open={true}
      close={onCancel}
      size="max"
      header={
        <Flex align="center" gap="2">
          <FaExclamationTriangle
            size={20}
            style={{ color: "var(--amber-9)" }}
          />
          <Text size="5" weight="bold">
            Merge Conflicts Detected
          </Text>
        </Flex>
      }
      trackingEventModalType="merge-conflict-resolver"
      cta={resolving ? "Resolving..." : "Apply Resolutions"}
      submit={handleResolve}
      ctaEnabled={allResolved && !resolving}
      secondaryCTA={
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <Box>
        <Callout status="warning" mb="4">
          The entity has been modified since this approval flow was created.
          Please resolve the conflicts below to continue.
        </Callout>

        <Heading size="4" mb="3" weight="medium">
          Conflicting Fields
        </Heading>

        <Flex direction="column" gap="4">
          {mergeResult.conflicts.map((conflict) => (
            <Card key={conflict.field} size="2">
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Text weight="bold" size="3">
                    {conflict.field}
                  </Text>
                  {resolutions[conflict.field] && (
                    <Badge color="green" size="1">
                      <FaCheck size={10} style={{ marginRight: 4 }} />
                      Resolved
                    </Badge>
                  )}
                </Flex>

                <Box
                  p="2"
                  style={{
                    backgroundColor: "var(--gray-2)",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <Text size="1" color="gray" mb="1" as="p">
                    Original value (when approval flow was created):
                  </Text>
                  <Code
                    language="json"
                    code={formatValue(conflict.baseValue)}
                  />
                </Box>

                <Flex gap="3" direction={{ initial: "column", md: "row" }}>
                  {/* Current (Live) Value Option */}
                  <Box
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "var(--radius-2)",
                      border: `2px solid ${
                        resolutions[conflict.field] === "current"
                          ? "var(--blue-8)"
                          : "var(--gray-5)"
                      }`,
                      backgroundColor:
                        resolutions[conflict.field] === "current"
                          ? "var(--blue-2)"
                          : "transparent",
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      setResolutions((prev) => ({
                        ...prev,
                        [conflict.field]: "current",
                      }))
                    }
                  >
                    <Flex align="center" gap="2" mb="2">
                      <input
                        type="radio"
                        checked={resolutions[conflict.field] === "current"}
                        onChange={() =>
                          setResolutions((prev) => ({
                            ...prev,
                            [conflict.field]: "current",
                          }))
                        }
                      />
                      <Text weight="medium" size="2" color="blue">
                        Keep Current Value
                      </Text>
                      <Badge color="blue" size="1" variant="soft">
                        Live
                      </Badge>
                    </Flex>
                    <Box
                      p="2"
                      style={{
                        backgroundColor: "var(--blue-3)",
                        borderRadius: "var(--radius-1)",
                        overflow: "auto",
                        maxHeight: "150px",
                      }}
                    >
                      <Code
                        language="json"
                        code={formatValue(conflict.liveValue)}
                      />
                    </Box>
                  </Box>

                  {/* Proposed Value Option */}
                  <Box
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "var(--radius-2)",
                      border: `2px solid ${
                        resolutions[conflict.field] === "proposed"
                          ? "var(--green-8)"
                          : "var(--gray-5)"
                      }`,
                      backgroundColor:
                        resolutions[conflict.field] === "proposed"
                          ? "var(--green-2)"
                          : "transparent",
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      setResolutions((prev) => ({
                        ...prev,
                        [conflict.field]: "proposed",
                      }))
                    }
                  >
                    <Flex align="center" gap="2" mb="2">
                      <input
                        type="radio"
                        checked={resolutions[conflict.field] === "proposed"}
                        onChange={() =>
                          setResolutions((prev) => ({
                            ...prev,
                            [conflict.field]: "proposed",
                          }))
                        }
                      />
                      <Text weight="medium" size="2" color="green">
                        Use Proposed Value
                      </Text>
                      <Badge color="green" size="1" variant="soft">
                        Proposed
                      </Badge>
                    </Flex>
                    <Box
                      p="2"
                      style={{
                        backgroundColor: "var(--green-3)",
                        borderRadius: "var(--radius-1)",
                        overflow: "auto",
                        maxHeight: "150px",
                      }}
                    >
                      <Code
                        language="json"
                        code={formatValue(conflict.proposedValue)}
                      />
                    </Box>
                  </Box>
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>

        {mergeResult.fieldsChanged.length > 0 && (
          <Box mt="5">
            <Heading size="4" mb="3" weight="medium">
              Auto-Merged Fields
            </Heading>
            <Text size="2" color="gray" mb="2" as="p">
              These fields can be merged automatically (no conflicts):
            </Text>
            <Flex gap="2" wrap="wrap">
              {mergeResult.fieldsChanged.map((field) => (
                <Badge key={field} color="gray" size="1" variant="soft">
                  {field}
                </Badge>
              ))}
            </Flex>
          </Box>
        )}
      </Box>
    </Modal>
  );
};

export default MergeConflictResolver;
