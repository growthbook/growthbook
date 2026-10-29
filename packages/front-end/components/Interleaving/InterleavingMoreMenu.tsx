import { useState } from "react";
import { useRouter } from "next/router";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { interleavingEnvsForChange } from "shared/permissions";
import { interleavingInSDKPayload } from "shared/util";
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
import { useEnvironments } from "@/services/features";

export default function InterleavingMoreMenu({
  interleaving: il,
  mutate,
  onEditInfo,
  onEditStatus,
  onAuditLog,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  onEditInfo?: () => void;
  onEditStatus?: () => void;
  onAuditLog?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();

  const canUpdate = permissionsUtil.canUpdateInterleaving(
    { project: il.project },
    {},
  );
  const canEdit = canUpdate && !il.archived;
  const changeEnvs = interleavingEnvsForChange({
    existing: il,
    environmentIds: environments.map((e) => e.id),
  });
  const canRunChange = permissionsUtil.canRunInterleaving(
    { project: il.project },
    changeEnvs,
  );
  const canRun = !il.archived && canRunChange;
  const canDelete = permissionsUtil.canDeleteInterleaving({
    project: il.project,
  });

  const setArchived = async (archived: boolean) => {
    await restApiCall(interleavingEndpoints.updateInterleaving, {
      params: { id: il.id },
      body: { archived },
    });
    await mutate();
  };

  if (!canUpdate && !canDelete && !onAuditLog) return null;

  const togglingArchiveServes =
    interleavingInSDKPayload(il) ||
    interleavingInSDKPayload({ ...il, archived: !il.archived });
  const showArchive = canUpdate && (!togglingArchiveServes || canRunChange);

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
          ml="2"
          aria-label="Interleaving experiment actions"
        >
          <PiDotsThreeVertical size={18} />
        </IconButton>
      }
      menuPlacement="end"
      variant="soft"
    >
      {canEdit && onEditInfo && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onEditInfo();
          }}
        >
          Edit info
        </DropdownMenuItem>
      )}
      {canRun && onEditStatus && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onEditStatus();
          }}
        >
          Edit status
        </DropdownMenuItem>
      )}
      {onAuditLog && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onAuditLog();
          }}
        >
          Audit history
        </DropdownMenuItem>
      )}
      {showArchive && <DropdownMenuSeparator />}
      {showArchive && il.archived && (
        <DropdownMenuItem
          onClick={async () => {
            setOpen(false);
            await setArchived(false);
          }}
        >
          Unarchive
        </DropdownMenuItem>
      )}
      {showArchive && !il.archived && (
        <DropdownMenuItem
          confirmation={{
            confirmationTitle: "Archive Interleaving Experiment",
            cta: "Archive",
            getConfirmationContent: async () =>
              il.status === "running"
                ? `"${il.name}" is running. Archiving it removes it from the SDK payload, so both rankers stop serving immediately. You can unarchive it later.`
                : `Archive "${il.name}"? It stays available on the Archived tab and can be unarchived later.`,
            submit: async () => {
              await setArchived(true);
            },
            closeDropdown: () => setOpen(false),
          }}
        >
          Archive
        </DropdownMenuItem>
      )}
      {canDelete && <DropdownMenuSeparator />}
      {canDelete && (
        <DropdownMenuItem
          color="red"
          confirmation={{
            confirmationTitle: "Delete Interleaving Experiment",
            cta: "Delete",
            ctaColor: "red",
            getConfirmationContent: async () =>
              `Are you sure you want to delete "${il.name}"? Its results snapshots go with it and this can't be undone. Archive it instead to keep the results.`,
            submit: async () => {
              await restApiCall(interleavingEndpoints.deleteInterleaving, {
                params: { id: il.id },
              });
              await router.push("/interleavings");
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
