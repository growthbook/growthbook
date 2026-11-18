import { ChevronDownIcon, Flex } from "@radix-ui/themes";
import { PiCheck, PiDatabase } from "react-icons/pi";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

// Ghost-button Data Source menu shared by the Product Analytics Explorer and
// the new-metric page.
export default function DataSourcePicker({
  value,
  options,
  onChange,
  disabled = false,
  confirmMessage,
}: {
  value: string | undefined;
  options: DataSourceInterfaceWithParams[];
  onChange: (datasourceId: string) => void;
  disabled?: boolean;
  // When switching would discard work, the confirmation text for the
  // Data Source named; null switches without asking.
  confirmMessage: ((name: string) => string) | null;
}) {
  const current = options.find((ds) => ds.id === value);
  const isDisabled = disabled || !options.length;

  return (
    <DropdownMenu
      disabled={isDisabled}
      trigger={
        <Button variant="ghost" icon={<PiDatabase />} disabled={isDisabled}>
          <Flex align="center" gap="2">
            <Text weight="medium">
              {current?.name || "Select a Data Source"}
            </Text>
            <ChevronDownIcon />
          </Flex>
        </Button>
      }
    >
      {options.map((ds) => {
        const selected = ds.id === value;
        const confirm = !selected && confirmMessage;
        return (
          <DropdownMenuItem
            key={ds.id}
            onClick={selected || confirm ? undefined : () => onChange(ds.id)}
            confirmation={
              confirm
                ? {
                    confirmationTitle: "Change Data Source",
                    cta: "Change",
                    ctaColor: "violet",
                    submit: () => onChange(ds.id),
                    getConfirmationContent: async () => confirm(ds.name),
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
