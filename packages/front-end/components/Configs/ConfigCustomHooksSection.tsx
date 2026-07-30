import { ConfigInterface } from "shared/types/config";
import { CustomHookInterface, hookEntityType } from "shared/validators";
import { getConfigAncestorKeys, getConfigSubtree } from "shared/util";
import { useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CompareCustomHookEventsModal from "@/components/Features/CompareCustomHookEventsModal";
import Badge from "@/ui/Badge";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";

// Config publish-time custom hooks — the Config analog of FeatureValidationTab's
// hooks section. Self-hosted + enterprise only.
export default function ConfigCustomHooksSection({
  config,
  canManage,
  lineage,
}: {
  config: ConfigInterface;
  canManage: boolean;
  // Family + mixin nodes, for resolving which ancestors' config hooks apply
  // to this config.
  lineage?: { key: string; parentKey: string | null; extendsKeys?: string[] }[];
}) {
  const { hasCommercialFeature } = useUser();
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );

  const hasAccess = hasCommercialFeature("custom-hooks");

  const { data, mutate } = useApi<{ customHooks: CustomHookInterface[] }>(
    "/custom-hooks",
    { shouldRun: () => hasAccess },
  );

  const ancestorKeys = useMemo(() => {
    const byKey = new Map(
      (lineage ?? []).map((n) => [
        n.key,
        { parent: n.parentKey ?? undefined, extends: n.extendsKeys },
      ]),
    );
    return getConfigAncestorKeys(
      { parent: config.parent, extends: config.extends },
      byKey,
    );
  }, [lineage, config.parent, config.extends]);

  // This config's position in its lineage — passed to the hook test prefill so
  // it mirrors what hooks receive at runtime.
  const configLineage = useMemo(() => {
    const nodes = (lineage ?? []).map((n) => ({
      key: n.key,
      parent: n.parentKey ?? undefined,
      extends: n.extendsKeys,
    }));
    const ancestors = [...ancestorKeys];
    const descendants = getConfigSubtree(config.key, nodes).filter(
      (k) => k !== config.key,
    );
    return {
      ancestors,
      descendants,
      hasParent: ancestors.length > 0,
      hasChildren: descendants.length > 0,
      isRoot: ancestors.length === 0,
      isLeaf: descendants.length === 0,
    };
  }, [ancestorKeys, lineage, config.key]);

  // Config-scoped hooks (by key, or family-scoped on an ancestor) plus
  // global/project config hooks in scope.
  const applicableHooks = useMemo(
    () =>
      (data?.customHooks || []).filter((h) => {
        const isConfigHook = hookEntityType[h.hook] === "config";
        if (h.entityType === "config") {
          return (
            h.entityId === config.key ||
            (!!h.entityId && ancestorKeys.has(h.entityId))
          );
        }
        return (
          isConfigHook &&
          !h.entityType &&
          (!h.projects.length || h.projects.includes(config.project || ""))
        );
      }),
    [data, config.key, config.project, ancestorKeys],
  );

  const disableReason = !hasAccess
    ? "Custom Hooks require an Enterprise plan."
    : !canManage
      ? "You don't have permission to manage hooks for this config."
      : "";

  if (isCloud()) return null;

  return (
    <Frame mb="4" px="6" py="4">
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          config={{
            key: config.key,
            project: config.project,
            name: config.name,
            value: config.value,
            schema: config.schema,
            lineage: configLineage,
          }}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      <Heading as="h3" size="medium" mb="1">
        Custom Hooks
      </Heading>
      <Box mb="3">
        <Text as="p" size="small" color="text-low" fontStyle="italic">
          Run sandboxed JavaScript validation before this config is published.
        </Text>
      </Box>

      {!hasAccess ? (
        <PremiumCallout
          commercialFeature="custom-hooks"
          id="config-custom-hooks"
        >
          Custom Hooks require an Enterprise plan.
        </PremiumCallout>
      ) : (
        <>
          <Flex align="center" gap="1" mb="3">
            <Heading as="h4" size="small" mb="0">
              Config-specific Hooks
            </Heading>
            <Box ml="auto">
              <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
                <Button
                  onClick={() => setModalData(true)}
                  disabled={!canManage}
                >
                  Add Config Hook
                </Button>
              </Tooltip>
            </Box>
          </Flex>
          <HooksTable
            hooks={applicableHooks.filter(
              (h) => h.entityType === "config" && h.entityId === config.key,
            )}
            config={config}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />

          {applicableHooks.some(
            (h) => h.entityType === "config" && h.entityId !== config.key,
          ) && (
            <>
              <Flex align="center" gap="1" mb="1" mt="4">
                <Heading as="h4" size="small" mb="0">
                  Parent Config Hooks
                </Heading>
              </Flex>
              <Text as="p" size="small" color="text-low" mb="3">
                Inherited from an ancestor config (scoped to descendants). These
                run on this config&apos;s changes but are managed from the
                parent.
              </Text>
              <HooksTable
                hooks={applicableHooks.filter(
                  (h) => h.entityType === "config" && h.entityId !== config.key,
                )}
                config={config}
                canManage={canManage}
                setModalData={setModalData}
                mutate={mutate}
                showSource
              />
            </>
          )}

          <Flex align="center" gap="1" mb="3" mt="5" pt="5">
            <Heading as="h4" size="small" mb="0">
              Global/Project Hooks
            </Heading>
            <Box ml="auto">
              <LinkButton href="/settings/custom-hooks" variant="soft">
                Manage in Settings <PiArrowSquareOut />
              </LinkButton>
            </Box>
          </Flex>
          <HooksTable
            hooks={applicableHooks.filter((h) => !h.entityId)}
            config={config}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />
        </>
      )}
    </Frame>
  );
}

function HookCodeModal({
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

function HooksTable({
  hooks,
  config,
  canManage,
  mutate,
  setModalData,
  showSource = false,
}: {
  hooks: CustomHookInterface[];
  config: ConfigInterface;
  canManage: boolean;
  setModalData: (hook: CustomHookInterface) => void;
  mutate: () => void;
  // Show a linked "Parent config" column instead of "Scope" (for inherited hooks).
  showSource?: boolean;
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
        <HookCodeModal
          hook={viewCodeHook}
          close={() => setViewCodeHook(null)}
        />
      )}
      {historyHook && (
        <CompareCustomHookEventsModal
          hook={historyHook}
          canRevert={
            canManage &&
            historyHook.entityType === "config" &&
            historyHook.entityId === config.key
          }
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
            {showSource && (
              <TableColumnHeader width="260px">Parent config</TableColumnHeader>
            )}
            <TableColumnHeader width="200px">Type</TableColumnHeader>
            {!showSource && (
              <TableColumnHeader width="180px">Scope</TableColumnHeader>
            )}
            <TableColumnHeader width="100px">Incremental</TableColumnHeader>
            {!showSource && <TableColumnHeader style={{ width: 50 }} />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {hooks.map((hook) => {
            const configScoped =
              hook.entityType === "config" && hook.entityId === config.key;
            // Scoped to an ancestor — applies here, but is managed from the
            // ancestor's page.
            const inherited =
              hook.entityType === "config" && hook.entityId !== config.key;
            const scopeLabel = configScoped
              ? "Config + descendants"
              : inherited
                ? `From ${hook.entityId}`
                : hook.projects.length
                  ? "Project"
                  : "Global";
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  <Link onClick={() => setViewCodeHook(hook)}>{hook.name}</Link>
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" ml="2" />
                  ) : null}
                </TableCell>
                {showSource && (
                  <TableCell>
                    {hook.entityId ? (
                      <Link href={`/configs/${hook.entityId}`}>
                        {hook.entityId}
                      </Link>
                    ) : null}
                  </TableCell>
                )}
                <TableCell>{hook.hook}</TableCell>
                {!showSource && <TableCell>{scopeLabel}</TableCell>}
                <TableCell>
                  {hook.incrementalChangesOnly ? "Yes" : "No"}
                </TableCell>
                {!showSource && (
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
                      {canManage && configScoped && (
                        <DropdownMenuItem onClick={() => setModalData(hook)}>
                          Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setHistoryHook(hook)}>
                        History &amp; revert
                      </DropdownMenuItem>
                      {canManage && configScoped && (
                        <DropdownMenuItem
                          onClick={async () => {
                            setToggleError(null);
                            try {
                              await apiCall(`/custom-hooks/${hook.id}`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  enabled: !hook.enabled,
                                }),
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
                      {canManage && configScoped && (
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
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
