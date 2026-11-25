import { useState } from "react";
import { useRouter } from "next/router";
import { Trans, useLingui } from "@lingui/react/macro";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import {
  canRunInterleavingControl,
  interleavingEnvsForChange,
} from "shared/permissions";
import { interleavingInSDKPayload } from "shared/util";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";

export default function InterleavingMoreMenu({
  interleaving: il,
  mutate,
  onEditInfo,
  onEditStatus,
  onDuplicate,
  onAuditLog,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  onEditInfo?: () => void;
  onEditStatus?: () => void;
  onDuplicate?: () => void;
  onAuditLog?: () => void;
}) {
  const { t } = useLingui();
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
  const canRun = canRunInterleavingControl(permissionsUtil, il, changeEnvs);
  // beforeDelete refuses while it is still serving, so offering it here would
  // guarantee an API error. Archive is the action that works.
  const canDelete =
    permissionsUtil.canDeleteInterleaving({ project: il.project }) &&
    !interleavingInSDKPayload(il);
  const canDuplicate = permissionsUtil.canCreateInterleaving({
    project: il.project,
  });

  const setArchived = async (archived: boolean) => {
    await restApiCall(interleavingEndpoints.updateInterleaving, {
      params: { id: il.id },
      body: { archived },
    });
    await mutate();
  };

  if (!canUpdate && !canDelete && !canDuplicate && !onAuditLog) return null;

  const togglingArchiveServes =
    interleavingInSDKPayload(il) ||
    interleavingInSDKPayload({ ...il, archived: !il.archived });
  const showArchive = canUpdate && (!togglingArchiveServes || canRunChange);
  const name = il.name;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <MoreMenuTrigger
          label={t`Interleaving experiment actions`}
          size="lg"
          ml="2"
        />
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
          <Trans>Edit info</Trans>
        </DropdownMenuItem>
      )}
      {canRun && (!il.archived || il.status === "running") && onEditStatus && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onEditStatus();
          }}
        >
          <Trans>Edit status</Trans>
        </DropdownMenuItem>
      )}
      {canDuplicate && onDuplicate && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onDuplicate();
          }}
        >
          <Trans>Duplicate</Trans>
        </DropdownMenuItem>
      )}
      {onAuditLog && (
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onAuditLog();
          }}
        >
          <Trans>Audit history</Trans>
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
          <Trans>Unarchive</Trans>
        </DropdownMenuItem>
      )}
      {showArchive && !il.archived && (
        <DropdownMenuItem
          confirmation={{
            confirmationTitle: t`Archive Interleaving Experiment`,
            cta: t`Archive`,
            getConfirmationContent: async () =>
              il.status === "running"
                ? t`"${name}" is running. Archiving it removes it from the SDK payload, so both rankers stop serving immediately. You can unarchive it later.`
                : t`Archive "${name}"? It stays available on the Archived tab and can be unarchived later.`,
            submit: async () => {
              await setArchived(true);
            },
            closeDropdown: () => setOpen(false),
          }}
        >
          <Trans>Archive</Trans>
        </DropdownMenuItem>
      )}
      {canDelete && <DropdownMenuSeparator />}
      {canDelete && (
        <DropdownMenuItem
          color="red"
          confirmation={{
            confirmationTitle: t`Delete Interleaving Experiment`,
            cta: t`Delete`,
            ctaColor: "red",
            getConfirmationContent: async () =>
              t`Are you sure you want to delete "${name}"? Its results snapshots go with it and this can't be undone. Archive it instead to keep the results.`,
            submit: async () => {
              await restApiCall(interleavingEndpoints.deleteInterleaving, {
                params: { id: il.id },
              });
              await router.push("/interleavings");
            },
            closeDropdown: () => setOpen(false),
          }}
        >
          <Trans>Delete</Trans>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
