import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiPlus, PiUserFill } from "react-icons/pi";
import { useEffect, useMemo, useState } from "react";
import { canInlineFilterColumn } from "shared/experiments";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { getColumnInfo } from "@/components/FactTables/rowFilterUtils";
import { ExplorerRowFilterInput } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerRowFilterInput";
import { factTableToColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function StartingEventSection() {
  const {
    draftUserJourneyState: draftState,
    setDraftUserJourneyState: setDraftState,
  } = useUserJourneyContext();
  const { getFactTableById, project } = useDefinitions();
  const { permissionsUtil } = useUser();
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const canRunFactQueries =
    permissionsUtil.canRunFactQueries({ projects: [project] }) ||
    permissionsUtil.canRunFactQueries({ projects: [] });
  const factTable = draftState.factTableId
    ? getFactTableById(draftState.factTableId)
    : null;
  const userIdTypes = useMemo(() => factTable?.userIdTypes ?? [], [factTable]);
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
    if (!factTable || !draftState.startingEventEventColumn?.column) return [];
    const { topValues } = getColumnInfo(
      factTable,
      draftState.startingEventEventColumn.column,
    );
    if (!topValues?.length) return [];
    return topValues
      .filter((v) => v)
      .map((v) => ({
        label: v,
        value: v,
      }));
  }, [factTable, draftState.startingEventEventColumn?.column]);
  const startingEventColumnSource = useMemo(() => {
    if (!factTable) return null;
    return factTableToColumnSource(factTable);
  }, [factTable]);

  useEffect(() => {
    if (!userIdTypes.length) return;
    setDraftState((prev) => {
      const currentUserIdType = prev.userIdType;
      const hasValidSelection =
        !!currentUserIdType && userIdTypes.includes(currentUserIdType);
      if (hasValidSelection) return prev;
      return {
        ...prev,
        userIdType: userIdTypes[0],
      };
    });
  }, [setDraftState, userIdTypes, draftState.userIdType]);

  return (
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
                    - You can select a column + a value from your Fact Table
                  </Text>
                  <Text weight="semibold"> OR </Text>
                  <Text>
                    - You can use filters to calculate the starting event of
                    this user journey.
                  </Text>
                </Flex>
              }
            />
          </Flex>
        </Text>
        <ButtonSelectField
          className="w-100"
          value={draftState.startingEventMode}
          setValue={(value: "eventColumn" | "filter") => {
            setDraftState((prev) => ({
              ...prev,
              startingEventMode: value,
              startingEventFilters:
                value === "filter" && prev.startingEventFilters.length === 0
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
        {draftState.startingEventMode === "eventColumn" ? (
          <Flex wrap="wrap" gap="3">
            <SelectField
              label={<Text weight="medium">Event column</Text>}
              value={draftState.startingEventEventColumn?.column || ""}
              disabled={!draftState.factTableId || !canRunFactQueries}
              onChange={(column) => {
                setDraftState((prev) => ({
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
              value={draftState.startingEventEventColumn?.value || ""}
              disabled={
                !draftState.startingEventEventColumn?.column ||
                !canRunFactQueries
              }
              onChange={(value) => {
                setDraftState((prev) => ({
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
            value={draftState.startingEventFilters}
            setValue={(value) => {
              setDraftState((prev) => ({
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
              setDraftState((prev) => ({
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
          {userIdTypes.length ? (
            <DropdownMenu
              open={unitDropdownOpen}
              onOpenChange={setUnitDropdownOpen}
              trigger={
                <Button size="xs" variant="ghost">
                  <Flex align="center" gap="2">
                    <PiUserFill />
                    {draftState.userIdType || "Select ID Type..."}
                  </Flex>
                </Button>
              }
            >
              {userIdTypes.map((idType) => (
                <DropdownMenuItem
                  key={idType}
                  onClick={() => {
                    setDraftState((prev) => ({
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
  );
}
