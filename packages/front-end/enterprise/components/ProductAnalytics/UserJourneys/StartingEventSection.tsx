import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiUserFill } from "react-icons/pi";
import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { RowFilterInput } from "@/components/FactTables/RowFilterInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function StartingEventSection() {
  const {
    draftUserJourneyState: draftState,
    setDraftUserJourneyState: setDraftState,
  } = useUserJourneyContext();
  console.log("draftState", draftState);
  const { getFactTableById } = useDefinitions();
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const factTable = draftState.factTableId
    ? getFactTableById(draftState.factTableId)
    : null;
  const userIdTypes = useMemo(() => factTable?.userIdTypes ?? [], [factTable]);

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
      </Flex>
      <Box>
        {factTable && (
          <RowFilterInput
            factTable={factTable}
            showLabel={false}
            value={draftState.startingEventFilters}
            setValue={(value) => {
              setDraftState((prev) => ({
                ...prev,
                startingEventFilters: value,
              }));
            }}
          />
        )}
        <Flex justify="end" align="center">
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
