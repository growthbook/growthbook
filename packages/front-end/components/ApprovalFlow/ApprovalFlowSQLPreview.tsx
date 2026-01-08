import React from "react";
import { FaMinus, FaPlus } from "react-icons/fa";
import { Box, Flex, Text, Heading } from "@radix-ui/themes";
import Code from "@/components/SyntaxHighlighting/Code";

interface SQLPreviewProps {
  currentSql: string | null;
  proposedSql: string | null;
  currentDenominatorSQL?: string;
  proposedDenominatorSQL?: string;
  sqlChanged: boolean;
  isFactMetric: boolean;
}

const ApprovalFlowSQLPreview: React.FC<SQLPreviewProps> = ({
  currentSql,
  proposedSql,
  currentDenominatorSQL,
  proposedDenominatorSQL,
  sqlChanged,
  isFactMetric,
}) => {
  if (sqlChanged) {
    return (
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Heading size="3" mb="3" weight="medium">
          SQL Query
        </Heading>
        <Flex gap="3" direction={{ initial: "column", md: "row" }}>
          {/* Current SQL */}
          <Box style={{ flex: 1 }}>
            <Flex align="center" gap="1" mb="2">
              <Box
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: "var(--red-4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaMinus size={8} style={{ color: "var(--red-11)" }} />
              </Box>
              <Text size="1" color="gray">
                Current
              </Text>
            </Flex>
            <Box
              style={{
                border: "1px solid var(--red-5)",
                borderRadius: "var(--radius-2)",
                overflow: "hidden",
              }}
            >
              <Code
                language="sql"
                code={currentSql || "-- No SQL query --"}
                expandable={true}
                filename={
                  isFactMetric && currentDenominatorSQL ? "Numerator" : undefined
                }
              />
              {isFactMetric && currentDenominatorSQL && (
                <Box mt="2">
                  <Code
                    language="sql"
                    code={currentDenominatorSQL}
                    expandable={true}
                    filename="Denominator"
                  />
                </Box>
              )}
            </Box>
          </Box>

          {/* Proposed SQL */}
          <Box style={{ flex: 1 }}>
            <Flex align="center" gap="1" mb="2">
              <Box
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: "var(--green-4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaPlus size={8} style={{ color: "var(--green-11)" }} />
              </Box>
              <Text size="1" color="gray">
                Proposed
              </Text>
            </Flex>
            <Box
              style={{
                border: "1px solid var(--green-5)",
                borderRadius: "var(--radius-2)",
                overflow: "hidden",
              }}
            >
              <Code
                language="sql"
                code={proposedSql || "-- No SQL query --"}
                expandable={true}
                filename={
                  isFactMetric && proposedDenominatorSQL ? "Numerator" : undefined
                }
              />
              {isFactMetric && proposedDenominatorSQL && (
                <Box mt="2">
                  <Code
                    language="sql"
                    code={proposedDenominatorSQL}
                    expandable={true}
                    filename="Denominator"
                  />
                </Box>
              )}
            </Box>
          </Box>
        </Flex>
      </Box>
    );
  }

  // SQL unchanged - show single view
  return (
    <Box style={{ flex: 1, minWidth: 0 }}>
      <Heading size="3" mb="3" weight="medium">
        SQL Query
      </Heading>
      <Box
        style={{
          border: "1px solid var(--gray-4)",
          borderRadius: "var(--radius-2)",
          overflow: "hidden",
        }}
      >
        <Code
          language="sql"
          code={currentSql || proposedSql || "-- No SQL query --"}
          expandable={true}
          filename={
            isFactMetric && (currentDenominatorSQL || proposedDenominatorSQL)
              ? "Numerator"
              : undefined
          }
        />
        {isFactMetric && (currentDenominatorSQL || proposedDenominatorSQL) && (
          <Box mt="2">
            <Code
              language="sql"
              code={currentDenominatorSQL || proposedDenominatorSQL || ""}
              expandable={true}
              filename="Denominator"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ApprovalFlowSQLPreview;
