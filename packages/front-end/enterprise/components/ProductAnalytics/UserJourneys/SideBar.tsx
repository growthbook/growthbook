import { Flex } from "@radix-ui/themes";
import { PiArrowsClockwise, PiPlus, PiUserFill } from "react-icons/pi";
import { useEffect, useMemo, useState } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import { UserJourneyConfig } from "shared/validators";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import RadioCards from "@/ui/RadioCards";
import Field from "@/components/Forms/Field";
import { getColumnInfo } from "@/components/FactTables/rowFilterUtils";
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
    if (!factTable || !draftUserJourneyState.startingEvent.column) return [];
    const { topValues } = getColumnInfo(
      factTable,
      draftUserJourneyState.startingEvent.column,
    );
    console.log("topValues", topValues);
    if (!topValues?.length) return [];
    return topValues
      .filter((v) => v)
      .map((v) => ({
        label: v,
        value: v,
      }));
  }, [factTable, draftUserJourneyState.startingEvent.column]);

  useEffect(() => {
    if (!factTable) return;
    const firstEventColumn = factTable.columns.find(
      (c) =>
        c.alwaysInlineFilter &&
        canInlineFilterColumn(factTable, c.column) &&
        !c.deleted,
    );
    setDraftUserJourneyState((prev) => {
      const updates: Partial<UserJourneyConfig> = {};
      if (factTable.userIdTypes?.length && !prev.userIdType) {
        updates.userIdType = factTable.userIdTypes[0];
      }
      updates.startingEvent = {
        column: firstEventColumn?.column ?? "",
        value: "",
      };
      return { ...prev, ...updates };
    });
  }, [factTable, factTable?.id, setDraftUserJourneyState]);

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
              disabled={loading}
              onClick={() => handleSubmit()}
            >
              Temporary Submit Button
            </Button>
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
              // shouldDisplay={isStale}
            >
              <Button
                size="sm"
                variant="solid"
                // disabled={
                //   loading ||
                //   !draftExploreState?.dataset?.values?.length ||
                //   !isSubmittable
                // }
                // onClick={() => handleSubmit({ force: isStale })}
                onClick={() => console.log("update")}
              >
                <Flex align="center" gap="2">
                  <PiArrowsClockwise />
                  Update
                  {/* {isStale && (
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
                  )} */}
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
        <Text weight="medium" mt="2">
          Fact Table
        </Text>
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
          <Text weight="medium" mt="2">
            Starting Event
          </Text>
          <SelectField
            label="Event column"
            value={draftUserJourneyState.startingEvent.column}
            disabled={
              !permissionsUtil.canRunFactQueries({ projects: [project] }) &&
              !permissionsUtil.canRunFactQueries({ projects: [] })
            }
            onChange={(column) => {
              setDraftUserJourneyState((prev) => ({
                ...prev,
                startingEvent: { column, value: "" },
              }));
            }}
            options={eventColumnOptions}
            placeholder="Select column..."
            forceUndefinedValueToNull
          />
          <SelectField
            label="Starting event"
            value={draftUserJourneyState.startingEvent.value}
            disabled={
              !draftUserJourneyState.startingEvent.column ||
              (!permissionsUtil.canRunFactQueries({ projects: [project] }) &&
                !permissionsUtil.canRunFactQueries({ projects: [] }))
            }
            onChange={(value) => {
              setDraftUserJourneyState((prev) => ({
                ...prev,
                startingEvent: {
                  ...prev.startingEvent,
                  value,
                },
              }));
            }}
            options={startingEventValueOptions}
            placeholder={
              draftUserJourneyState.startingEvent.column &&
              !startingEventValueOptions.length
                ? "No values loaded (refresh column in Fact Table settings)"
                : "Select starting event..."
            }
            forceUndefinedValueToNull
          />
          <Flex justify="between" align="center" mt="2">
            <Button
              size="xs"
              variant="ghost"
              style={{ maxWidth: "fit-content" }}
              onClick={() => {
                alert("This has not been implemented yet");
              }}
              // disabled={!canAddFilter}
            >
              <Flex align="center" gap="2">
                <PiPlus size={14} />
                Add Filter
              </Flex>
            </Button>

            <DropdownMenu
              open={unitDropdownOpen}
              onOpenChange={setUnitDropdownOpen}
              trigger={
                <Button size="xs" variant="ghost">
                  <Flex align="center" gap="2">
                    <PiUserFill />{" "}
                    {draftUserJourneyState.userIdType ?? "Select Unit..."}
                  </Flex>
                </Button>
              }
            >
              {factTable?.userIdTypes.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onClick={() => {
                    setDraftUserJourneyState((prev) => ({
                      ...prev,
                      userIdType: t,
                    }));
                    setUnitDropdownOpen(false);
                  }}
                >
                  <Text>{t}</Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenu>
          </Flex>
        </>
        <>
          <Text weight="medium" mt="2">
            Measured As
          </Text>
          <RadioCards
            columns="2"
            width="100%"
            options={[
              { label: "Totals", value: "total" },
              { label: "Uniques", value: "unique" },
            ]}
            value={draftUserJourneyState.measurementType}
            setValue={(value: "total" | "unique") => {
              setDraftUserJourneyState((prev) => ({
                ...prev,
                measurementType: value,
              }));
            }}
          />
        </>
        <>
          <Text weight="medium" mt="2">
            Completed Time
          </Text>
          <Flex direction="row" gap="2">
            <Field
              value={draftUserJourneyState.conversionWindow.value}
              type="number"
              // MKTODO: Add min and max
              onChange={(e) => {
                setDraftUserJourneyState((prev) => ({
                  ...prev,
                  conversionWindow: {
                    ...prev.conversionWindow,
                    value: parseInt(e.target.value),
                  },
                }));
              }}
              placeholder="Enter completed time..."
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
              placeholder="Select completed time..."
              forceUndefinedValueToNull
            />
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
          <Text weight="medium">Group By</Text>
          <Button
            size="xs"
            variant="ghost"
            disabled={true}
            onClick={() => alert("This has not been implemented yet")}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} /> Add
            </Flex>
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
