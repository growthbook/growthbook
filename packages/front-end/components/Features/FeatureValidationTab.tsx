import { FeatureInterface } from "shared/types/feature";
import { CustomHookInterface } from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import JSONValidation from "@/components/Features/JSONValidation";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHooksTable from "@/components/CustomHooks/CustomHooksTable";
import PremiumCallout from "@/ui/PremiumCallout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";

export default function FeatureValidationTab({
  feature,
  revision,
  mutate,
  setVersion,
  revisionList,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  mutate: () => void;
  setVersion?: (version: number) => void;
  revisionList?: MinimalFeatureRevisionInterface[];
}) {
  return (
    <div className="contents container-fluid pagecontents">
      {/* JSON / simple schema validation (not applicable to boolean flags) */}
      {feature.valueType !== "boolean" && (
        <Frame mb="4" px="6" py="4">
          <JSONValidation
            feature={feature}
            mutate={mutate}
            setVersion={setVersion}
            revisionList={revisionList || []}
          />
        </Frame>
      )}

      {/* Custom Hooks are self-hosted only */}
      {!isCloud() && (
        <Frame mb="4" px="6" py="4">
          <CustomHooksSection feature={feature} revision={revision} />
        </Frame>
      )}
    </div>
  );
}

function CustomHooksSection({
  feature,
  revision,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
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

  const canManage = permissionsUtil.canManageFeatureCustomHooks(feature);

  const applicableHooks = useMemo(
    () =>
      (data?.customHooks || []).filter(
        (h) =>
          (h.entityType === "feature" && h.entityId === feature.id) ||
          (!h.entityType &&
            (!h.projects.length || h.projects.includes(feature.project || ""))),
      ),
    [data, feature.id, feature.project],
  );

  let disableReason = "";
  if (!hasAccessToCustomHooks) {
    disableReason = "Custom Hooks require an Enterprise plan.";
  } else if (!canManage) {
    disableReason =
      "You don't have permission to manage custom hooks for this feature.";
  }

  return (
    <Box>
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          feature={feature}
          revision={revision}
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
            Run sandboxed JavaScript validation before this feature is saved.
          </em>
        </Text>
      </Box>

      {!hasAccessToCustomHooks ? (
        <PremiumCallout
          commercialFeature="custom-hooks"
          id="custom-hooks-validation-tab"
        >
          Custom Hooks require an Enterprise plan.
        </PremiumCallout>
      ) : (
        <>
          <Flex align="center" justify="between" gap="1" mb="1">
            <Heading as="h4" size="small" mb="0">
              Feature-specific Hooks
            </Heading>
            <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
              <Button
                onClick={() => setModalData(true)}
                disabled={!hasAccessToCustomHooks || !canManage}
              >
                Add Feature Hook
              </Button>
            </Tooltip>
          </Flex>
          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !!hook.entityId)}
            entityType="feature"
            entityId={feature.id}
            scopeLabel="Feature"
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
            entityType="feature"
            entityId={feature.id}
            scopeLabel="Feature"
            canManage={canManage}
            setModalData={setModalData}
            mutate={mutate}
          />
        </>
      )}
    </Box>
  );
}
