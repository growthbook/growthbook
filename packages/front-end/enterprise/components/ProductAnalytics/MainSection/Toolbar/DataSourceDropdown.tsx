import React, { useState } from "react";
import { ChevronDownIcon, Flex } from "@radix-ui/themes";
import { PiDatabase, PiCheck } from "react-icons/pi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";

export default function DataSourceDropdown() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { draftExploreState, clearAllDatasets, isSubmittable } =
    useExplorerContext();
  const { datasources } = useDefinitions();

  const isDataSourceEmpty = datasources.length === 0;

  const triggerLabel =
    datasources.find((ds) => ds.id === draftExploreState?.datasource)?.name ||
    "Select a data source";

  const isCurrentDatasource = (dsId: string) =>
    dsId === draftExploreState?.datasource;

  return (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      disabled={isDataSourceEmpty}
      trigger={
        <Button variant="ghost" icon={<PiDatabase />}>
          <Flex align="center" gap="2">
            <Text weight="medium">{triggerLabel}</Text>
            <ChevronDownIcon />
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
            onClick={
              isSubmittable
                ? undefined
                : () => {
                    clearAllDatasets(ds.id);
                    setDropdownOpen(false);
                  }
            }
            confirmation={
              isSubmittable
                ? {
                    confirmationTitle: "Change data source",
                    cta: "Change",
                    submitColor: "primary",
                    submit: () => clearAllDatasets(ds.id),
                    getConfirmationContent: async () =>
                      `Changing the data source will clear your current exploration. Are you sure you want to switch to "${ds.name}"?`,
                  }
                : undefined
            }
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
