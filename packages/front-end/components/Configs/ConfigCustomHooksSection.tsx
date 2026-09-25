import { ConfigInterface } from "shared/types/config";
import { CustomHookInterface, hookEntityType } from "shared/validators";
import { getConfigAncestorKeys, getConfigSubtree } from "shared/util";
import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHooksTable, {
  HookScope,
  hookScopeColumn,
  isHookScopedTo,
} from "@/components/CustomHooks/CustomHooksTable";
import PremiumCallout from "@/ui/PremiumCallout";
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

  const scope: HookScope = {
    entityType: "config",
    entityId: config.key,
    label: "Config + descendants",
  };
  const configScoped = (h: CustomHookInterface) => isHookScopedTo(h, scope);

  const disableReason = !hasAccess
    ? "Custom Hooks require an Enterprise plan."
    : !canManage
      ? "You don't have permission to manage hooks for this Config."
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
      <Heading as="h3" size="md" mb="1">
        Custom Hooks
      </Heading>
      <Box mb="3">
        <Text as="p" size="sm" color="text-low" fontStyle="italic">
          Run sandboxed JavaScript validation before this Config is published.
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
            <Heading as="h4" size="sm" mb="0">
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
          <CustomHooksTable
            hooks={applicableHooks.filter(configScoped)}
            column={hookScopeColumn(scope)}
            showIncremental
            canManage={(h) => canManage && configScoped(h)}
            onEdit={setModalData}
            mutate={mutate}
          />

          {applicableHooks.some(
            (h) => h.entityType === "config" && h.entityId !== config.key,
          ) && (
            <>
              <Flex align="center" gap="1" mb="1" mt="4">
                <Heading as="h4" size="sm" mb="0">
                  Parent Config Hooks
                </Heading>
              </Flex>
              <Text as="p" size="sm" color="text-low" mb="3">
                Inherited from an ancestor Config (scoped to descendants). These
                run on this Config&apos;s changes but are managed from the
                parent.
              </Text>
              <CustomHooksTable
                hooks={applicableHooks.filter(
                  (h) => h.entityType === "config" && !configScoped(h),
                )}
                column={{
                  header: "Parent Config",
                  width: "260px",
                  render: (h) => (
                    <Link href={`/configs/${h.entityId}`}>{h.entityId}</Link>
                  ),
                }}
                showIncremental
                canManage={() => false}
                mutate={mutate}
              />
            </>
          )}

          <Flex align="center" gap="1" mb="3" mt="5" pt="5">
            <Heading as="h4" size="sm" mb="0">
              Global/Project Hooks
            </Heading>
            <Box ml="auto">
              <LinkButton href="/settings/custom-hooks" variant="soft">
                Manage in Settings <PiArrowSquareOut />
              </LinkButton>
            </Box>
          </Flex>
          <CustomHooksTable
            hooks={applicableHooks.filter((h) => !h.entityId)}
            column={hookScopeColumn(scope)}
            showIncremental
            canManage={() => false}
            mutate={mutate}
          />
        </>
      )}
    </Frame>
  );
}
