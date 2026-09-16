import { ReactNode, useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { CustomHookEntityType, CustomHookInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { hookTypes } from "@/components/CustomHooks/CustomHookModal";
import CustomHookCodeModal from "@/components/CustomHooks/CustomHookCodeModal";
import CompareCustomHookEventsModal from "@/components/Features/CompareCustomHookEventsModal";

export interface CustomHooksTableColumn {
  header: string;
  width?: string;
  render: (hook: CustomHookInterface) => ReactNode;
}

export interface HookScope {
  entityType: CustomHookEntityType;
  entityId: string;
  /** Scope label for hooks bound to this entity, e.g. "Feature". */
  label: string;
}

export function isHookScopedTo(
  hook: CustomHookInterface,
  scope: HookScope,
): boolean {
  return (
    hook.entityType === scope.entityType && hook.entityId === scope.entityId
  );
}

export function hookScopeColumn(scope: HookScope): CustomHooksTableColumn {
  return {
    header: "Scope",
    width: "180px",
    render: (hook) =>
      isHookScopedTo(hook, scope)
        ? scope.label
        : hook.projects.length
          ? "Project"
          : "Global",
  };
}

export default function CustomHooksTable({
  hooks,
  column,
  showIncremental = false,
  canManage,
  canRevert = canManage,
  onEdit,
  mutate,
}: {
  hooks: CustomHookInterface[];
  /** Context column between Type and the actions menu: scope, projects, or owning entity. */
  column?: CustomHooksTableColumn;
  showIncremental?: boolean;
  /** Rows that can be toggled and deleted here (and edited, when onEdit is set). Other rows only offer history. */
  canManage: (hook: CustomHookInterface) => boolean;
  canRevert?: (hook: CustomHookInterface) => boolean;
  onEdit?: (hook: CustomHookInterface) => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [viewCodeHook, setViewCodeHook] = useState<CustomHookInterface | null>(
    null,
  );
  const [historyHook, setHistoryHook] = useState<CustomHookInterface | null>(
    null,
  );
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (!hooks.length) {
    return (
      <Text color="text-low">
        <em>No custom hooks yet.</em>
      </Text>
    );
  }

  return (
    <>
      {viewCodeHook && (
        <CustomHookCodeModal
          hook={viewCodeHook}
          close={() => setViewCodeHook(null)}
        />
      )}
      {historyHook && (
        <CompareCustomHookEventsModal
          hook={historyHook}
          canRevert={canRevert(historyHook)}
          onClose={() => setHistoryHook(null)}
          onRevert={() => mutate()}
        />
      )}
      {toggleError && (
        <Callout status="error" mb="3">
          {toggleError}
        </Callout>
      )}
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader width="200px">Type</TableColumnHeader>
            {column && (
              <TableColumnHeader width={column.width}>
                {column.header}
              </TableColumnHeader>
            )}
            {showIncremental && (
              <TableColumnHeader width="100px">Incremental</TableColumnHeader>
            )}
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hooks.map((hook) => {
            const manageable = canManage(hook);
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  <Link onClick={() => setViewCodeHook(hook)}>{hook.name}</Link>
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" ml="2" />
                  ) : null}
                </TableCell>
                <TableCell>
                  {hookTypes[hook.hook]?.label ?? hook.hook}
                </TableCell>
                {column && <TableCell>{column.render(hook)}</TableCell>}
                {showIncremental && (
                  <TableCell>
                    {hook.incrementalChangesOnly ? "Yes" : "No"}
                  </TableCell>
                )}
                <TableCell>
                  <DropdownMenu
                    variant="soft"
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                      >
                        <BsThreeDotsVertical size={16} />
                      </IconButton>
                    }
                    menuPlacement="end"
                  >
                    {manageable && onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(hook)}>
                        Edit
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setHistoryHook(hook)}>
                      History &amp; revert
                    </DropdownMenuItem>
                    {manageable && (
                      <DropdownMenuItem
                        onClick={async () => {
                          setToggleError(null);
                          try {
                            await apiCall(`/custom-hooks/${hook.id}`, {
                              method: "PUT",
                              body: JSON.stringify({ enabled: !hook.enabled }),
                            });
                            await mutate();
                          } catch (err) {
                            setToggleError(
                              err instanceof Error
                                ? err.message
                                : "Failed to update hook",
                            );
                          }
                        }}
                      >
                        {hook.enabled ? "Disable" : "Enable"}
                      </DropdownMenuItem>
                    )}
                    {manageable && (
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: async () => {
                            await apiCall(`/custom-hooks/${hook.id}`, {
                              method: "DELETE",
                            });
                            await mutate();
                          },
                          confirmationTitle: "Delete custom hook",
                          cta: "Delete",
                          getConfirmationContent: async () =>
                            "Are you sure? This action cannot be undone.",
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
