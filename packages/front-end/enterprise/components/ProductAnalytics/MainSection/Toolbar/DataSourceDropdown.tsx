import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiDatabase, PiCheck } from "react-icons/pi";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";

export default function DataSourceDropdown() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { draftExploreState, clearAllDatasets } = useExplorerContext();
  const { datasources } = useDefinitions();

  const triggerLabel =
    datasources.find((ds) => ds.id === draftExploreState?.datasource)?.name ||
    "Data Source";

  const isCurrentDatasource = (dsId: string) =>
    dsId === draftExploreState?.datasource;

  return (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      trigger={
        <Button variant="ghost">
          <Flex align="center" gap="2">
            <PiDatabase />
            <Text weight="medium">{triggerLabel}</Text>
          </Flex>
        </Button>
      }
    >
      {datasources.map((ds) =>
        isCurrentDatasource(ds.id) ? (
          <DropdownMenuItem key={ds.id} onClick={() => setDropdownOpen(false)}>
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" width="20px">
                <PiCheck size={16} />
              </Flex>
              {ds.name}
            </Flex>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            key={ds.id}
            confirmation={{
              confirmationTitle: "Change data source",
              cta: "Change",
              submitColor: "primary",
              submit: () => clearAllDatasets(ds.id),
              getConfirmationContent: async () =>
                `Changing the data source will clear your current exploration. Are you sure you want to switch to "${ds.name}"?`,
            }}
          >
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" width="20px" />
              {ds.name}
            </Flex>
          </DropdownMenuItem>
        ),
      )}
    </DropdownMenu>
  );
}
