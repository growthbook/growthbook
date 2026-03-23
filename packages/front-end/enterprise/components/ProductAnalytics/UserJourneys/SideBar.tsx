import { Flex, Box, Separator } from "@radix-ui/themes";
import { PiArrowsClockwise, PiPlus, PiUserFill } from "react-icons/pi";
import { useEffect, useMemo, useState } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import toNumber from "lodash/toNumber";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import Field from "@/components/Forms/Field";
import { getColumnInfo } from "@/components/FactTables/rowFilterUtils";
import { factTableToColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";
import { ExplorerRowFilterInput } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerRowFilterInput";
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
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const { factTables, project, getFactTableById } = useDefinitions();
  const { permissionsUtil } = useUser();

  const factTable = draftUserJourneyState.factTableId
    ? getFactTableById(draftUserJourneyState.factTableId)
    : null;

  const eventColumnOptions = useMemo(() => {
    if (!factTable) return [];
    return factTable.columns
      .filter(
        (c) =>
          c.alwaysInlineFilter &&
          canInlineFilterColumn(factTable, c.column) &&
          !c.deleted,
      )
      .map((c) => ({
        label: c.name || c.column,
        value: c.column,
      }));
  }, [factTable]);

  const startingEventValueOptions = useMemo(() => {
    if (!factTable || !draftUserJourneyState.startingEventEventColumn?.column)
      return [];
    const { topValues } = getColumnInfo(
      factTable,
      draftUserJourneyState.startingEventEventColumn.column,
    );
    console.log("topValues", topValues);
    if (!topValues?.length) return [];
    return topValues
      .filter((v) => v)
      .map((v) => ({
        label: v,
        value: v,
      }));
  }, [factTable, draftUserJourneyState.startingEventEventColumn?.column]);

  const startingEventColumnSource = useMemo(() => {
    if (!factTable) return null;
    return factTableToColumnSource(factTable);
  }, [factTable]);

  useEffect(() => {
    if (!factTable?.userIdTypes?.length) return;

    setDraftUserJourneyState((prev) => {
      const currentUserIdType = prev.userIdType;
      const hasValidSelection =
        !!currentUserIdType &&
        factTable.userIdTypes.includes(currentUserIdType);

      if (hasValidSelection) return prev;

      return {
        ...prev,
        userIdType: factTable.userIdTypes[0],
      };
    });
  }, [factTable, draftUserJourneyState.userIdType, setDraftUserJourneyState]);

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
          disabled={
            !permissionsUtil.canRunFactQueries({ projects: [project] }) &&
            !permissionsUtil.canRunFactQueries({ projects: [] })
          }
          onChange={(factTableId) => {
            setDraftUserJourneyState((prev) => ({
              ...prev,
              factTableId,
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
      {/* Add check here */}
      {draftUserJourneyState.factTableId ? (
        <>
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
            <Flex direction="column" gap="1">
              <Text weight="medium">
                <Flex align="center" gap="1" mb="1">
                  Define a Starting Event
                  <Tooltip
                    body={
                      <Flex direction="column" gap="2">
                        <Text weight="medium">
                          There are two ways to define a starting event:
                        </Text>
                        <Separator size="4" />
                        <Text>
                          - You can select a column + a value from your Fact
                          Table
                        </Text>
                        <Text weight="semibold"> OR </Text>
                        <Text>
                          - You can use filters to calculate the starting event
                          of this user journey.
                        </Text>
                      </Flex>
                    }
                  />
                </Flex>
              </Text>
              <ButtonSelectField
                className="w-100"
                value={draftUserJourneyState.startingEventMode}
                setValue={(value: "eventColumn" | "filter") => {
                  setDraftUserJourneyState((prev) => ({
                    ...prev,
                    startingEventMode: value,
                    startingEventFilters:
                      value === "filter" &&
                      prev.startingEventFilters.length === 0
                        ? [{ column: "", operator: "=", values: [] }]
                        : prev.startingEventFilters,
                  }));
                }}
                options={[
                  { label: "Event Column", value: "eventColumn" },
                  { label: "Filter", value: "filter" },
                ]}
              />
            </Flex>
            <Box mt="2">
              {draftUserJourneyState.startingEventMode === "eventColumn" ? (
                <Flex wrap="wrap" gap="3">
                  <SelectField
                    label={<Text weight="medium">Event column</Text>}
                    value={
                      draftUserJourneyState.startingEventEventColumn?.column ||
                      ""
                    }
                    disabled={
                      !draftUserJourneyState.factTableId ||
                      (!permissionsUtil.canRunFactQueries({
                        projects: [project],
                      }) &&
                        !permissionsUtil.canRunFactQueries({ projects: [] }))
                    }
                    onChange={(column) => {
                      setDraftUserJourneyState((prev) => ({
                        ...prev,
                        startingEventEventColumn: { column, value: "" },
                      }));
                    }}
                    options={eventColumnOptions}
                    placeholder={"Select column"}
                    forceUndefinedValueToNull
                  />
                  <SelectField
                    label={<Text weight="medium">Starting event</Text>}
                    value={
                      draftUserJourneyState.startingEventEventColumn?.value ||
                      ""
                    }
                    disabled={
                      !draftUserJourneyState.startingEventEventColumn?.column ||
                      (!permissionsUtil.canRunFactQueries({
                        projects: [project],
                      }) &&
                        !permissionsUtil.canRunFactQueries({ projects: [] }))
                    }
                    onChange={(value) => {
                      setDraftUserJourneyState((prev) => ({
                        ...prev,
                        startingEventEventColumn: {
                          column: prev.startingEventEventColumn?.column || "",
                          value,
                        },
                      }));
                    }}
                    options={startingEventValueOptions}
                    placeholder={"Select event"}
                    forceUndefinedValueToNull
                  />
                </Flex>
              ) : null}
            </Box>
            <Box>
              {startingEventColumnSource && (
                <ExplorerRowFilterInput
                  columnSource={startingEventColumnSource}
                  value={draftUserJourneyState.startingEventFilters}
                  setValue={(value) => {
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      startingEventFilters: value,
                    }));
                  }}
                />
              )}
              <Flex justify="between" align="center">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      startingEventFilters: [
                        ...prev.startingEventFilters,
                        { column: "", operator: "=", values: [] },
                      ],
                    }))
                  }
                >
                  <Flex align="center" gap="2">
                    <PiPlus size={14} /> Add Filter
                  </Flex>
                </Button>
                {factTable?.userIdTypes?.length ? (
                  <DropdownMenu
                    open={unitDropdownOpen}
                    onOpenChange={setUnitDropdownOpen}
                    trigger={
                      <Button size="xs" variant="ghost">
                        <Flex align="center" gap="2">
                          <PiUserFill />
                          {draftUserJourneyState.userIdType ||
                            "Select ID Type..."}
                        </Flex>
                      </Button>
                    }
                  >
                    {factTable.userIdTypes.map((idType) => (
                      <DropdownMenuItem
                        key={idType}
                        onClick={() => {
                          setDraftUserJourneyState((prev) => ({
                            ...prev,
                            userIdType: idType,
                          }));
                          setUnitDropdownOpen(false);
                        }}
                      >
                        <Text>{idType}</Text>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                ) : null}
              </Flex>
            </Box>
          </Flex>
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
            <>
              <Text weight="medium">
                <Flex align="center" gap="1">
                  Measured As
                  <Tooltip body="Determine whether to count total events or unique events per id type"></Tooltip>
                </Flex>
              </Text>

              <ButtonSelectField
                className="w-100"
                value={draftUserJourneyState.measurementType}
                setValue={(value: "total" | "unique") => {
                  setDraftUserJourneyState((prev) => ({
                    ...prev,
                    measurementType: value,
                  }));
                }}
                options={[
                  { label: "Totals", value: "total" },
                  { label: "Uniques", value: "unique" },
                ]}
              />
            </>
            <>
              <Flex align="center" gap="2" wrap="wrap">
                {/* MKTODO: Need to add validation here so a user can select more than 1 day*/}
                <Text weight="medium">Completed within</Text>
                <Field
                  value={draftUserJourneyState.conversionWindow.value}
                  type="number"
                  min={1}
                  style={{ width: 50 }}
                  onChange={(e) => {
                    const nextValue = parseInt(e.target.value);
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      conversionWindow: {
                        ...prev.conversionWindow,
                        value: Number.isFinite(nextValue)
                          ? nextValue
                          : prev.conversionWindow.value,
                      },
                    }));
                  }}
                  placeholder="1"
                />
                <SelectField
                  value={draftUserJourneyState.conversionWindow.unit}
                  onChange={(unit: "minute" | "hour") => {
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      conversionWindow: {
                        ...prev.conversionWindow,
                        unit,
                      },
                    }));
                  }}
                  options={[
                    { label: "Minute(s)", value: "minute" },
                    { label: "Hour(s)", value: "hour" },
                  ]}
                  isSearchable={false}
                  style={{ width: 120 }}
                  forceUndefinedValueToNull
                />
              </Flex>
            </>
            <>
              <Flex align="center" gap="2" wrap="wrap">
                {/* MKTODO: Need to add validation here so a user can select more than 1 day*/}
                <Text weight="medium">Show top</Text>
                <SelectField
                  value={draftUserJourneyState.numOfEventsPerStep.toString()}
                  sort={false}
                  style={{ width: "50px" }}
                  onChange={(value) =>
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      numOfEventsPerStep: toNumber(value),
                    }))
                  }
                  options={[
                    { label: "1", value: "1" },
                    { label: "2", value: "2" },
                    { label: "3", value: "3" },
                    { label: "4", value: "4" },
                    { label: "5", value: "5" },
                    { label: "6", value: "6" },
                    { label: "7", value: "7" },
                    { label: "8", value: "8" },
                    { label: "9", value: "9" },
                    { label: "10", value: "10" },
                  ]}
                />
                <Text weight="medium">events per step</Text>
              </Flex>
            </>
          </Flex>
          <Flex
            direction="column"
            gap="2"
            p="3"
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-4)",
              backgroundColor: "var(--color-panel-translucent)",
            }}
          >
            <Flex justify="between" align="center">
              <Text weight="medium">Global Filters</Text>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setDraftUserJourneyState((prev) => ({
                    ...prev,
                    globalFilters: [
                      ...prev.globalFilters,
                      { column: "", operator: "=", values: [] },
                    ],
                  }))
                }
              >
                <Flex align="center" gap="2">
                  <PiPlus size={14} /> Add
                </Flex>
              </Button>
            </Flex>
            {startingEventColumnSource &&
            draftUserJourneyState.globalFilters.length > 0 ? (
              <ExplorerRowFilterInput
                columnSource={startingEventColumnSource}
                value={draftUserJourneyState.globalFilters}
                setValue={(value) =>
                  setDraftUserJourneyState((prev) => ({
                    ...prev,
                    globalFilters: value,
                  }))
                }
              />
            ) : null}
          </Flex>
          <UserJourneyGroupBySection />
        </>
      ) : null}
    </Flex>
  );
}
