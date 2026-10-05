import { ChevronDownIcon, Flex } from "@radix-ui/themes";
import { PiCheck, PiDatabase } from "react-icons/pi";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// Page-level data source picker for a new metric - same look as the
// Product Analytics Explorer's DataSourceDropdown, but bound to a value
// instead of ExplorerContext.
export default function DatasourcePicker({
  value,
  options,
  onChange,
  confirmChange,
}: {
  value: string;
  options: DataSourceInterfaceWithParams[];
  onChange: (datasourceId: string) => void;
  // Switching clears the chosen fact tables, so confirm once there are any.
  confirmChange: boolean;
}) {
  const current = options.find((ds) => ds.id === value);

  return (
    <DropdownMenu
      disabled={!options.length}
      trigger={
        <Button
          variant="ghost"
          icon={<PiDatabase />}
          disabled={!options.length}
        >
          <Flex align="center" gap="2">
            <Text weight="medium">
              {current?.name || "Select a data source"}
            </Text>
            <ChevronDownIcon />
          </Flex>
        </Button>
      }
    >
      {options.map((ds) => {
        const selected = ds.id === value;
        return (
          <DropdownMenuItem
            key={ds.id}
            onClick={
              selected || confirmChange ? undefined : () => onChange(ds.id)
            }
            confirmation={
              !selected && confirmChange
                ? {
                    confirmationTitle: "Change data source",
                    cta: "Change",
                    ctaColor: "violet",
                    submit: () => onChange(ds.id),
                    getConfirmationContent: async () =>
                      `Changing the data source clears the fact tables you've chosen. Switch to "${ds.name}"?`,
                  }
                : undefined
            }
          >
            <Flex align="center" gap="2">
              <Flex align="center" width="20px">
                {selected && <PiCheck size={16} />}
              </Flex>
              {ds.name}
            </Flex>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenu>
  );
}
