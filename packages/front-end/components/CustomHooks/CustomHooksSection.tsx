import {
  CustomHookInterface,
  customHookEntityNoun,
  hookEntityType,
} from "shared/validators";
import { ComponentProps, ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHooksTable, {
  CustomHooksTableColumn,
  HookScope,
  hookScopeColumn,
  isHookScopedTo,
} from "@/components/CustomHooks/CustomHooksTable";

// The custom hooks that validate changes to one entity: its own, any it
// inherits, and the global and Project hooks in scope. One layout for every
// entity that has hooks. Self-hosted + enterprise only.
export default function CustomHooksSection({
  scope,
  projects,
  description,
  canManage,
  modalProps,
  inherited,
}: {
  scope: HookScope;
  // The entity's Projects; a Project hook applies when it names one of them.
  projects: string[];
  description: string;
  canManage: boolean;
  // The entity the Add / Edit modal scopes a hook to.
  modalProps: Pick<
    ComponentProps<typeof CustomHookModal>,
    | "feature"
    | "revision"
    | "config"
    | "sdkConnection"
    | "sdkConnectionRevision"
  >;
  // Hooks scoped to another entity that also run on this one.
  inherited?: {
    title: string;
    description: string;
    entityIds: ReadonlySet<string>;
    column: CustomHooksTableColumn;
  };
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

  if (isCloud()) return null;

  const hooks = data?.customHooks || [];
  const ownHooks = hooks.filter((h) => isHookScopedTo(h, scope));
  const inheritedHooks = hooks.filter(
    (h) =>
      h.entityType === scope.entityType &&
      !!h.entityId &&
      !!inherited?.entityIds.has(h.entityId),
  );
  const sharedHooks = hooks.filter(
    (h) =>
      !h.entityType &&
      hookEntityType[h.hook] === scope.entityType &&
      (!h.projects.length || h.projects.some((p) => projects.includes(p))),
  );

  const noun = customHookEntityNoun[scope.entityType];

  const header = (title: string, action: ReactNode, first = false) => (
    <Flex
      align="center"
      justify="between"
      gap="4"
      mt={first ? "0" : "5"}
      mb="2"
      minHeight="32px"
    >
      <Heading as={first ? "h3" : "h4"} size={first ? "md" : "sm"} mb="0">
        {title}
      </Heading>
      {action}
    </Flex>
  );

  return (
    <Frame mb="4" px="6" py="4">
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          {...modalProps}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      {header(
        "Custom Hooks",
        hasAccess ? (
          <Tooltip
            content="You don't have permission to manage these Custom Hooks."
            enabled={!canManage}
          >
            <Button onClick={() => setModalData(true)} disabled={!canManage}>
              Add hook
            </Button>
          </Tooltip>
        ) : null,
        true,
      )}
      <Text as="p" color="text-low" mb="3">
        {description}
      </Text>

      {!hasAccess ? (
        <PremiumCallout
          commercialFeature="custom-hooks"
          id={`${scope.entityType}-custom-hooks`}
        >
          Custom Hooks require an Enterprise plan.
        </PremiumCallout>
      ) : (
        <>
          <CustomHooksTable
            hooks={ownHooks}
            column={hookScopeColumn(scope)}
            showIncremental
            canManage={() => canManage}
            onEdit={setModalData}
            mutate={mutate}
            emptyMessage={`No hooks are scoped to this ${noun} yet.`}
          />

          {inherited && inheritedHooks.length > 0 && (
            <>
              {header(inherited.title, null)}
              <Text as="p" color="text-low" mb="3">
                {inherited.description}
              </Text>
              <CustomHooksTable
                hooks={inheritedHooks}
                column={inherited.column}
                showIncremental
                canManage={() => false}
                mutate={mutate}
              />
            </>
          )}

          {header(
            "Global/Project Hooks",
            <LinkButton
              href="/settings/custom-hooks"
              variant="soft"
              external
              icon={<PiArrowSquareOut />}
              iconPosition="right"
            >
              Manage in Settings
            </LinkButton>,
          )}
          <CustomHooksTable
            hooks={sharedHooks}
            column={hookScopeColumn(scope)}
            showIncremental
            canManage={() => false}
            mutate={mutate}
            emptyMessage={`No global or Project hooks apply to this ${noun}.`}
          />
        </>
      )}
    </Frame>
  );
}
