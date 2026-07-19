import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CustomHookInterface } from "shared/validators";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHooksTable from "@/components/CustomHooks/CustomHooksTable";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";

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
            entityType="experiment"
            entityId={experiment.id}
            scopeLabel="Experiment"
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
            entityType="experiment"
            entityId={experiment.id}
            scopeLabel="Experiment"
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />
        </>
      )}
    </Box>
  );
}
