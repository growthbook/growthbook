import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CustomHookInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import CustomHookModal, {
  hookTypes,
} from "@/components/CustomHooks/CustomHookModal";
import CustomHookCodeModal from "@/components/CustomHooks/CustomHookCodeModal";
import Badge from "@/ui/Badge";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";

function getHookScopeLabel(
  hook: CustomHookInterface,
  experiment: ExperimentInterfaceStringDates,
): string {
  if (hook.entityType === "experiment" && hook.entityId === experiment.id) {
    return "Experiment";
  }
  if (hook.projects.length) {
    return "Project";
  }
  return "Global";
}

function isExperimentScopedHook(
  hook: CustomHookInterface,
  experiment: ExperimentInterfaceStringDates,
): boolean {
  return hook.entityType === "experiment" && hook.entityId === experiment.id;
}

export default function ExperimentCustomHooksSection({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
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

  const canManage = permissionsUtil.canManageExperimentCustomHooks(experiment);

  const applicableHooks = useMemo(
    () =>
      (data?.customHooks || []).filter(
        (h) =>
          h.hook === "validateExperiment" &&
          ((h.entityType === "experiment" && h.entityId === experiment.id) ||
            (!h.entityType &&
              (!h.projects.length ||
                h.projects.includes(experiment.project || "")))),
      ),
    [data, experiment.id, experiment.project],
  );

  let disableReason = "";
  if (!hasAccessToCustomHooks) {
    disableReason = "Custom Hooks require an Enterprise plan.";
  } else if (!canManage) {
    disableReason =
      "You don't have permission to manage custom hooks for this experiment.";
  }

  return (
    <Box>
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          experiment={experiment}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      <Heading as="h3" size="medium" mb="1">
        Custom Hooks
      </Heading>
      <Box mb="3">
        <Text color="text-low">
          <em>
            Run sandboxed JavaScript validation before this experiment is saved.
          </em>
        </Text>
      </Box>

      {!hasAccessToCustomHooks ? (
        <PremiumCallout
          commercialFeature="custom-hooks"
          id="experiment-custom-hooks-section"
        >
          Custom Hooks require an Enterprise plan.
        </PremiumCallout>
      ) : (
        <>
          <Flex align="center" justify="between" gap="1" mb="1">
            <Heading as="h4" size="small" mb="0">
              Experiment-specific Hooks
            </Heading>
            <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
              <Button
                onClick={() => setModalData(true)}
                disabled={!hasAccessToCustomHooks || !canManage}
              >
                Add Experiment Hook
              </Button>
            </Tooltip>
          </Flex>
          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !!hook.entityId)}
            experiment={experiment}
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />

          <Flex align="center" justify="between" gap="1" mb="1" mt="5" pt="5">
            <Heading as="h4" size="small" mb="0">
              Global/Project Hooks
            </Heading>
            <LinkButton
              href="/settings/custom-hooks"
              variant="soft"
              disabled={!hasAccessToCustomHooks || !canManage}
            >
              Manage in Settings <PiArrowSquareOut />
            </LinkButton>
          </Flex>

          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !hook.entityId)}
            experiment={experiment}
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
  experiment,
  canManage,
  mutate,
  setModalData,
}: {
  hooks: CustomHookInterface[];
  experiment: ExperimentInterfaceStringDates;
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
            const experimentScoped = isExperimentScopedHook(hook, experiment);
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  {hook.name}
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" />
                  ) : null}
                </TableCell>
                <TableCell>
                  {hookTypes[hook.hook]?.label ?? hook.hook}
                </TableCell>
                <TableCell>{getHookScopeLabel(hook, experiment)}</TableCell>
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
                    {canManage && experimentScoped && (
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
                    {canManage && experimentScoped && (
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
                    {canManage && experimentScoped && (
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
