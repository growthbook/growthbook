import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiDatabase, PiCheck } from "react-icons/pi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Link from "@/ui/Link";

interface DataSourceDropdownProps {
  value: string;
  setValue: (datasourceId: string) => void;
  isSubmittable: boolean;
}

export default function DataSourceDropdown({
  value: datasourceId,
  setValue,
  isSubmittable,
}: DataSourceDropdownProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { datasources } = useDefinitions();

  const triggerLabel =
    datasources.find((ds) => ds.id === datasourceId)?.name || "Data Source";

  const isCurrentDatasource = (dsId: string) => dsId === datasourceId;

  return (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      trigger={
        <Link>
          <Flex align="center" gap="2">
            <PiDatabase />
            <Text weight="medium">{triggerLabel}</Text>
          </Flex>
        </Link>
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
                    setValue(ds.id);
                    setDropdownOpen(false);
                  }
            }
            confirmation={
              isSubmittable
                ? {
                    confirmationTitle: "Change data source",
                    cta: "Change",
                    submitColor: "primary",
                    submit: () => setValue(ds.id),
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
