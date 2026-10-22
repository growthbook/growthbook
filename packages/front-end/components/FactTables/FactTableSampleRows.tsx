import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RowFilter, RowFilterTestResults } from "shared/types/fact-table";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { TestQueryResultsTable } from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// Sample rows cost a warehouse query, so they only load on a click
export default function FactTableSampleRows({
  factTableId,
  rowFilters = [],
}: {
  factTableId: string;
  rowFilters?: RowFilter[];
}) {
  const { apiCall } = useAuth();
  const { testQueryDays } = useOrgSettings();
  const [result, setResult] = useState<RowFilterTestResults | null>(null);

  if (!result) {
    return (
      <Flex direction="column" align="start" gap="1">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const res = await apiCall<{ result: RowFilterTestResults }>(
              `/fact-tables/${factTableId}/test-row-filters`,
              { method: "POST", body: JSON.stringify({ rowFilters }) },
            );
            setResult(res.result);
          }}
        >
          Load sample rows
        </Button>
        <Text size="sm" color="text-low">
          Runs a query for up to 20 rows from the last{" "}
          {testQueryDays ?? DEFAULT_TEST_QUERY_DAYS} days.
        </Text>
      </Flex>
    );
  }

  return (
    <Box>
      <TestQueryResultsTable
        duration={result.duration || 0}
        results={result.results || []}
        sql={result.sql || ""}
        error={result.error || ""}
        expandable={false}
        allowDownload={true}
      />
    </Box>
  );
}
