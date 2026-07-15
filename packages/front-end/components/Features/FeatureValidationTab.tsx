import { FeatureInterface } from "shared/types/feature";
import { CustomHookInterface } from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
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
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import JSONValidation from "@/components/Features/JSONValidation";
import CustomHookModal from "@/components/CustomHooks/CustomHookModal";
import CustomHookCodeModal from "@/components/CustomHooks/CustomHookCodeModal";
import Badge from "@/ui/Badge";
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

function getHookScopeLabel(
  hook: CustomHookInterface,
  feature: FeatureInterface,
): string {
  if (hook.entityType === "feature" && hook.entityId === feature.id) {
    return "Feature";
  }
  if (hook.projects.length) {
    return "Project";
  }
  return "Global";
}

function isFeatureScopedHook(
  hook: CustomHookInterface,
  feature: FeatureInterface,
): boolean {
  return hook.entityType === "feature" && hook.entityId === feature.id;
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
        <em className="text-muted">
          Run sandboxed JavaScript validation before this feature is saved.
        </em>
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
          <Flex align="center" gap="1" mb="1">
            <Heading as="h4" size="small" mb="0">
              Feature-specific Hooks
            </Heading>
            <div className="ml-auto">
              <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
                <Button
                  onClick={() => setModalData(true)}
                  disabled={!hasAccessToCustomHooks || !canManage}
                >
                  Add Feature Hook
                </Button>
              </Tooltip>
            </div>
          </Flex>
          <CustomHooksTable
            hooks={applicableHooks.filter((hook) => !!hook.entityId)}
            feature={feature}
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
            feature={feature}
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
  feature,
  canManage,
  mutate,
  setModalData,
}: {
  hooks: CustomHookInterface[];
  feature: FeatureInterface;
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
            const featureScoped = isFeatureScopedHook(hook, feature);
            return (
              <TableRow key={hook.id}>
                <TableCell>
                  {hook.name}
                  {!hook.enabled ? (
                    <Badge color="gray" label="Disabled" />
                  ) : null}
                </TableCell>
                <TableCell>{hook.hook}</TableCell>
                <TableCell>{getHookScopeLabel(hook, feature)}</TableCell>
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
                    {canManage && featureScoped && (
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
                    {canManage && featureScoped && (
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
                    {canManage && featureScoped && (
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
