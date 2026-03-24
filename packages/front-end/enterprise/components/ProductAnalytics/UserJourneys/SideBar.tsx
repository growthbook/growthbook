import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise } from "react-icons/pi";
import { canInlineFilterColumn } from "shared/experiments";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AdditionalOptionsSection from "./AdditionalOptionsSection";
import GlobalFiltersSection from "./GlobalFiltersSection";
import StartingEventSection from "./StartingEventSection";
import UserJourneyGroupBySection from "./GroupBySection";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function SideBar({
  renderingInDashboardSidebar,
}: {
  renderingInDashboardSidebar: boolean;
}) {
  const {
    draftUserJourneyState,
    setDraftUserJourneyState,
    handleSubmit,
    loading,
    error,
    isStale,
    isSubmittable,
  } = useUserJourneyContext();
  const { factTables, project } = useDefinitions();
  const { permissionsUtil } = useUser();
  const canRunFactQueries =
    permissionsUtil.canRunFactQueries({ projects: [project] }) ||
    permissionsUtil.canRunFactQueries({ projects: [] });

  // Check if the user can create dashboards for the current pr
  return (
    <Flex
      direction="column"
      gap="4"
      p={renderingInDashboardSidebar ? "0" : "2"}
    >
      {/* {error && renderingInDashboardSidebar ? (
        <Callout status="error">{error}</Callout>
      ) : null} */}
      <Flex justify="end" height="32px" py="2">
        {!renderingInDashboardSidebar ? (
          // <Tooltip
          //   body={saveToDashboardDisabledReason || ""}
          //   shouldDisplay={!!saveToDashboardDisabledReason}
          // >
          <>
            {error && <Callout status="error">{error}</Callout>}
            <Button
              size="sm"
              ml="auto"
              disabled={true}
              // disabled={!!saveToDashboardDisabledReason}
              onClick={() => {
                // if (!hasDashboardsFeature) {
                //   setShowUpgradeModal(true);
                // } else {
                //   setShowSaveToDashboardModal(true);
                // }
              }}
            >
              <Flex align="center" justify="center" gap="2">
                <PaidFeatureBadge
                  commercialFeature="product-analytics-dashboards"
                  useTip={false}
                />
                Save to Dashboard
              </Flex>
            </Button>
          </>
        ) : (
          // </Tooltip>
          <Flex direction="row" align="center" justify="between" width="100%">
            {/* <DataSourceDropdown /> */}
            <Tooltip
              body="Configuration has changed. Click to refresh the chart."
              shouldDisplay={isStale}
            >
              <Button
                size="sm"
                variant="solid"
                disabled={loading || !isSubmittable}
                onClick={() => handleSubmit({ force: isStale })}
              >
                <Flex align="center" gap="2">
                  <PiArrowsClockwise />
                  Update
                  {isStale && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: "var(--amber-9)",
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                  )}
                </Flex>
              </Button>
            </Tooltip>
          </Flex>
        )}
      </Flex>
      {renderingInDashboardSidebar && (
        <div>Dashboard sidebar content goes here</div>
      )}

      <Flex
        width="100%"
        direction="column"
        p="3"
        gap="2"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <Text weight="medium">Fact Table</Text>
        <SelectField
          value={draftUserJourneyState.factTableId || ""}
          disabled={!canRunFactQueries}
          onChange={(factTableId) => {
            const selectedFactTable = factTables.find(
              (f) => f.id === factTableId,
            );
            const seededColumn =
              selectedFactTable?.columns.find(
                (c) =>
                  c.alwaysInlineFilter &&
                  !c.deleted &&
                  canInlineFilterColumn(selectedFactTable, c.column) &&
                  !selectedFactTable.userIdTypes.includes(c.column),
              )?.column ?? "";

            setDraftUserJourneyState((prev) => ({
              ...prev,
              factTableId,
              startingEventFilters: [
                {
                  column: seededColumn,
                  operator: "=",
                  values: [],
                },
                ...prev.startingEventFilters.slice(1),
              ],
            }));
          }}
          options={factTables
            .filter((f) => f.datasource === draftUserJourneyState.datasource)
            .map((ft) => ({
              label: ft.name,
              value: ft.id,
            }))}
          placeholder="Select fact table..."
          forceUndefinedValueToNull
        />
      </Flex>
      {draftUserJourneyState.factTableId ? (
        <>
          <StartingEventSection />
          <AdditionalOptionsSection />
          <GlobalFiltersSection />
          <UserJourneyGroupBySection />
        </>
      ) : null}
    </Flex>
  );
}
