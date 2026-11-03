import { useState } from "react";
import { populationEndpoints } from "shared/api-endpoints";
import { ApiPopulation } from "shared/validators";
import { IconButton } from "@radix-ui/themes";
import { PiDotsThreeVertical } from "react-icons/pi";
import { radixSize } from "@/ui/sizes";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export default function PopulationMoreMenu({
  population,
  onDuplicated,
  onDeleted,
  onAuditLog,
}: {
  population: ApiPopulation;
  onDuplicated: (copy: ApiPopulation) => Promise<unknown> | void;
  onDeleted: () => Promise<unknown> | void;
  onAuditLog?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();

  const canDuplicate = permissionsUtil.canCreatePopulation(population);
  const canDelete = permissionsUtil.canDeletePopulation(population);
  if (!canDuplicate && !canDelete && !onAuditLog) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size={radixSize("md")}
          highContrast
          aria-label="Population actions"
        >
          <PiDotsThreeVertical size={18} />
        </IconButton>
      }
      menuPlacement="end"
      variant="soft"
    >
      {onAuditLog && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onAuditLog();
          }}
        >
          Audit log
        </DropdownMenuItem>
      )}
      {canDuplicate && (
        <DropdownMenuItem
          onClick={async () => {
            const { population: copy } = await restApiCall(
              populationEndpoints.createPopulation,
              {
                body: {
                  name: `${population.name} (copy)`,
                  description: population.description,
                  projects: population.projects,
                  datasource: population.datasource,
                  userIdTypes: population.userIdTypes,
                  steps: population.steps,
                },
              },
            );
            setOpen(false);
            await onDuplicated(copy);
          }}
        >
          Duplicate
        </DropdownMenuItem>
      )}
      {(onAuditLog || canDuplicate) && canDelete && <DropdownMenuSeparator />}
      {canDelete && (
        <DropdownMenuItem
          color="red"
          confirmation={{
            confirmationTitle: "Delete Population",
            cta: "Delete",
            ctaColor: "red",
            getConfirmationContent: async () =>
              `Are you sure you want to delete "${population.name}"? This can't be undone.`,
            submit: async () => {
              await restApiCall(populationEndpoints.deletePopulation, {
                params: { id: population.id },
              });
              await onDeleted();
            },
            closeDropdown: () => setOpen(false),
          }}
        >
          Delete
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
