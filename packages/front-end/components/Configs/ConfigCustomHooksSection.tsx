import { ConfigInterface } from "shared/types/config";
import { CustomHookInterface, hookEntityType } from "shared/validators";
import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
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

// Config publish-time custom hooks — the Config analog of FeatureValidationTab's
// hooks section. Self-hosted + enterprise only.
export default function ConfigCustomHooksSection({
  config,
  canManage,
}: {
  config: ConfigInterface;
  canManage: boolean;
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

  // Config-scoped hooks (by key) plus global/project config hooks in scope.
  const applicableHooks = useMemo(
    () =>
      (data?.customHooks || []).filter((h) => {
        const isConfigHook = hookEntityType[h.hook] === "config";
        if (h.entityType === "config") return h.entityId === config.key;
        return (
          isConfigHook &&
          !h.entityType &&
          (!h.projects.length || h.projects.includes(config.project || ""))
        );
      }),
    [data, config.key, config.project],
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
          }}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      <Heading as="h3" size="medium" mb="1">
        Custom Hooks
      </Heading>
      <Box mb="3">
        <em className="text-muted">
          Run sandboxed JavaScript validation before this config is published.
        </em>
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
          <Flex align="center" gap="1" mb="1">
            <Heading as="h4" size="small" mb="0">
              Config-specific Hooks
            </Heading>
            <div className="ml-auto">
              <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
                <Button
                  onClick={() => setModalData(true)}
                  disabled={!canManage}
                >
                  Add Config Hook
                </Button>
              </Tooltip>
            </div>
          </Flex>
          <HooksTable
            hooks={applicableHooks.filter((h) => !!h.entityId)}
            config={config}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />

          <Flex align="center" gap="1" mb="1" mt="5" pt="5">
            <Heading as="h4" size="small" mb="0">
              Global/Project Hooks
            </Heading>
            <div className="ml-auto">
              <LinkButton href="/settings/custom-hooks" variant="soft">
                Manage in Settings <PiArrowSquareOut />
              </LinkButton>
            </div>
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
}: {
  hooks: CustomHookInterface[];
  config: ConfigInterface;
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
        <HookCodeModal
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
            const configScoped =
              hook.entityType === "config" && hook.entityId === config.key;
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  {hook.name}
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" />
                  ) : null}
                </TableCell>
                <TableCell>{hook.hook}</TableCell>
                <TableCell>
                  {configScoped
                    ? "Config"
                    : hook.projects.length
                      ? "Project"
                      : "Global"}
                </TableCell>
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
                    {canManage && configScoped && (
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
                    {canManage && configScoped && (
                      <a
                        href="#"
                        className="dropdown-item"
                        onClick={async (e) => {
                          e.preventDefault();
                          await apiCall(`/custom-hooks/${hook.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ enabled: !hook.enabled }),
                          });
                          await mutate();
                        }}
                      >
                        {hook.enabled ? "Disable" : "Enable"}
                      </a>
                    )}
                    {canManage && configScoped && (
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
