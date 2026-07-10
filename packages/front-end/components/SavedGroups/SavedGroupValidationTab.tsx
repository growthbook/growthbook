import { SavedGroupInterface } from "shared/types/saved-group";
import { CustomHookInterface } from "shared/validators";
import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import CustomHookModal from "@/components/Features/CustomHookModal";
import Badge from "@/ui/Badge";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";

export default function SavedGroupValidationTab({
  savedGroup,
}: {
  savedGroup: SavedGroupInterface;
}) {
  // Custom Hooks are self-hosted only
  if (isCloud()) return null;

  return (
    <div className="contents container-fluid pagecontents">
      <Frame mb="4" px="6" py="4">
        <CustomHooksSection savedGroup={savedGroup} />
      </Frame>
    </div>
  );
}

function getHookScopeLabel(
  hook: CustomHookInterface,
  savedGroup: SavedGroupInterface,
): string {
  if (hook.entityType === "savedGroup" && hook.entityId === savedGroup.id) {
    return "Saved Group";
  }
  if (hook.projects.length) {
    return "Project";
  }
  return "Global";
}

function isSavedGroupScopedHook(
  hook: CustomHookInterface,
  savedGroup: SavedGroupInterface,
): boolean {
  return hook.entityType === "savedGroup" && hook.entityId === savedGroup.id;
}

function CustomHookCodeModal({
  hook,
  close,
}: {
  hook: CustomHookInterface;
  close: () => void;
}) {
  return (
    <ModalStandard
      open
      header={hook.name}
      subheader={hook.hook}
      close={close}
      closeCta="Close"
      size="lg"
      trackingEventModalType=""
    >
      <Code language="javascript" code={hook.code} />
    </ModalStandard>
  );
}

function CustomHooksSection({
  savedGroup,
}: {
  savedGroup: SavedGroupInterface;
}) {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );

  const hasAccessToCustomHooks = hasCommercialFeature("custom-hooks");

  const { data, mutate } = useApi<{ customHooks: CustomHookInterface[] }>(
    "/custom-hooks",
    { shouldRun: () => hasAccessToCustomHooks },
  );

  const canManage = permissionsUtil.canManageSavedGroupCustomHooks(savedGroup);

  const applicableHooks = useMemo(
    () =>
      (data?.customHooks || []).filter(
        (h) =>
          (h.entityType === "savedGroup" && h.entityId === savedGroup.id) ||
          (!h.entityType &&
            (!h.projects.length ||
              h.projects.some((p) => (savedGroup.projects || []).includes(p)))),
      ),
    [data, savedGroup.id, savedGroup.projects],
  );

  let disableReason = "";
  if (!hasAccessToCustomHooks) {
    disableReason = "Custom Hooks require an Enterprise plan.";
  } else if (!canManage) {
    disableReason =
      "You don't have permission to manage custom hooks for this saved group.";
  }

  return (
    <Box>
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          savedGroup={savedGroup}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      <Heading as="h3" size="medium" mb="1">
        Custom Hooks
      </Heading>
      <Box mb="3">
        <em className="text-muted">
          Run sandboxed JavaScript validation before this saved group is saved.
        </em>
      </Box>

      {!hasAccessToCustomHooks ? (
        <PremiumCallout
          commercialFeature="custom-hooks"
          id="custom-hooks-saved-group-validation-tab"
        >
          Custom Hooks require an Enterprise plan.
        </PremiumCallout>
      ) : (
        <>
          <Flex align="center" gap="1" mb="1">
            <Heading as="h4" size="small" mb="0">
              Saved Group-specific Hooks
            </Heading>
            <div className="ml-auto">
              <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
                <Button
                  onClick={() => setModalData(true)}
                  disabled={!hasAccessToCustomHooks || !canManage}
                >
                  Add Saved Group Hook
                </Button>
              </Tooltip>
            </div>
          </Flex>
          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !!hook.entityId)}
            savedGroup={savedGroup}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />

          <Flex align="center" gap="1" mb="1" mt="5" pt="5">
            <Heading as="h4" size="small" mb="0">
              Global/Project Hooks
            </Heading>
            <div className="ml-auto">
              <LinkButton
                href="/settings/custom-hooks"
                variant="soft"
                disabled={!hasAccessToCustomHooks || !canManage}
              >
                Manage in Settings <PiArrowSquareOut />
              </LinkButton>
            </div>
          </Flex>

          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !hook.entityId)}
            savedGroup={savedGroup}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />
        </>
      )}
    </Box>
  );
}

function CustomHooksTable({
  hooks,
  savedGroup,
  canManage,
  mutate,
  setModalData,
}: {
  hooks: CustomHookInterface[];
  savedGroup: SavedGroupInterface;
  canManage: boolean;
  setModalData: (hook: CustomHookInterface) => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [viewCodeHook, setViewCodeHook] = useState<CustomHookInterface | null>(
    null,
  );

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
      <Table variant="list" stickyHeader roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader width="200px">Type</TableColumnHeader>
            <TableColumnHeader width="150px">Scope</TableColumnHeader>
            <TableColumnHeader width="100px">Incremental</TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hooks.map((hook) => {
            const savedGroupScoped = isSavedGroupScopedHook(hook, savedGroup);
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  {hook.name}
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" />
                  ) : null}
                </TableCell>
                <TableCell>{hook.hook}</TableCell>
                <TableCell>{getHookScopeLabel(hook, savedGroup)}</TableCell>
                <TableCell>
                  {hook.incrementalChangesOnly ? "Yes" : "No"}
                </TableCell>
                <TableCell>
                  <MoreMenu useRadix={false}>
                    <a
                      href="#"
                      className="dropdown-item"
                      onClick={(e) => {
                        e.preventDefault();
                        setViewCodeHook(hook);
                      }}
                    >
                      Preview Code
                    </a>
                    {canManage && savedGroupScoped && (
                      <a
                        href="#"
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setModalData(hook);
                        }}
                      >
                        Edit
                      </a>
                    )}
                    {canManage && savedGroupScoped && (
                      <a
                        href="#"
                        className="dropdown-item"
                        onClick={async (e) => {
                          e.preventDefault();
                          await apiCall(`/custom-hooks/${hook.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              enabled: !hook.enabled,
                            }),
                          });
                          await mutate();
                        }}
                      >
                        {hook.enabled ? "Disable" : "Enable"}
                      </a>
                    )}
                    {canManage && savedGroupScoped && (
                      <DeleteButton
                        useRadix={false}
                        useIcon={false}
                        text="Delete"
                        displayName="custom hook"
                        onClick={async () => {
                          await apiCall(`/custom-hooks/${hook.id}`, {
                            method: "DELETE",
                          });
                          await mutate();
                        }}
                        className="dropdown-item text-danger"
                      />
                    )}
                  </MoreMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
