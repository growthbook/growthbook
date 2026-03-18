import { useState, useCallback } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { getValidDate } from "shared/dates";
import { IconButton, Flex } from "@radix-ui/themes";
import DateRangePicker from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import LastRefreshedIndicator from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/LastRefreshedIndicator";
import QueryModal from "@/components/Experiment/QueryModal";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import { pathRowsToTableData } from "./userJourneyResultsUtils";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function Toolbar() {
  const {
    draftUserJourneyState,
    setDraftUserJourneyState,
    userJourney,
    query,
  } = useUserJourneyContext();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [queryModalOpen, setQueryModalOpen] = useState(false);

  const hasResults = (userJourney?.result?.rows?.length ?? 0) > 0;
  const hasQuery = !!query?.query;

  const handleViewSqlQuery = useCallback(() => {
    setQueryModalOpen(true);
    setDropdownOpen(false);
  }, []);

  const handleDownloadCsv = useCallback(() => {
    const rows = userJourney?.result?.rows ?? [];
    if (!rows.length) return;
    const { rowData } = pathRowsToTableData(rows);
    const csv = convertToCSV(rowData);
    if (!csv) return;
    downloadCSVFile(csv, "user-journey-results.csv");
    setDropdownOpen(false);
  }, [userJourney?.result?.rows]);

  const showMoreMenu = hasResults || hasQuery;

  return (
    <>
      <Flex direction="column" gap="3">
        {/* Top Toolbar */}
        <Flex justify="between" align="center" height="32px">
          {/* Left Side */}
          <Flex align="center" gap="3">
            <DataSourceDropdown
              value={draftUserJourneyState.datasource}
              setValue={(datasourceId) =>
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  datasource: datasourceId,
                  factTableId: "",
                }))
              }
              isSubmittable={false}
            />
          </Flex>

          {/* Right Side */}
          <Flex align="center" gap="3">
            <LastRefreshedIndicator
              lastRefreshedAt={
                userJourney?.runStarted
                  ? getValidDate(userJourney.runStarted)
                  : null
              }
            />
          </Flex>
        </Flex>

        {/* Bottom Toolbar */}
        <Flex justify="between" align="center" height="32px">
          {/* Left Side */}
          <Flex align="center" gap="3" />
          {/* Right Side */}
          <Flex align="center" gap="3">
            <DateRangePicker
              value={draftUserJourneyState.dateRange}
              setValue={(updater) =>
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  dateRange: updater(prev.dateRange),
                }))
              }
              showLookbackUnit={false}
            />
            {showMoreMenu && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="3"
                    highContrast
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                open={dropdownOpen}
                onOpenChange={(o) => setDropdownOpen(!!o)}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  {hasQuery && (
                    <DropdownMenuItem onClick={handleViewSqlQuery}>
                      View SQL Query
                    </DropdownMenuItem>
                  )}
                  {hasResults && (
                    <DropdownMenuItem onClick={handleDownloadCsv}>
                      Download Results as CSV
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenu>
            )}
          </Flex>
        </Flex>
      </Flex>
      {queryModalOpen && hasQuery && query?.query && (
        <QueryModal
          close={() => setQueryModalOpen(false)}
          queries={[query.query]}
          language={query.language ?? "sql"}
        />
      )}
    </>
  );
}
