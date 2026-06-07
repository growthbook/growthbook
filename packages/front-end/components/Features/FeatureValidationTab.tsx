import { FeatureInterface } from "shared/types/feature";
import { CustomHookInterface } from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCode } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
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
import JSONValidation from "@/components/Features/JSONValidation";
import CustomHookModal from "@/components/Features/CustomHookModal";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";

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
  feature,
  revision,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
}) {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );
  const [viewCodeHook, setViewCodeHook] = useState<CustomHookInterface | null>(
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
      {viewCodeHook && (
        <CustomHookCodeModal
          hook={viewCodeHook}
          close={() => setViewCodeHook(null)}
        />
      )}
      <Flex align="center" gap="1" mb="1">
        <Heading as="h3" size="medium" mb="0">
          Custom Hooks
        </Heading>
        <div className="ml-auto">
          <Tooltip body={disableReason} shouldDisplay={!!disableReason}>
            <Button
              onClick={() => setModalData(true)}
              disabled={!hasAccessToCustomHooks || !canManage}
            >
              Add Custom Hook
            </Button>
          </Tooltip>
        </div>
      </Flex>
      <Box mb="3">
        <em className="text-muted">
          Run sandboxed JavaScript validation before this feature is saved.
        </em>
      </Box>

      {!hasAccessToCustomHooks ? (
        <Callout status="info">
          Custom Hooks require an Enterprise plan.
        </Callout>
      ) : applicableHooks.length === 0 ? (
        <p className="text-muted">No custom hooks apply to this feature yet.</p>
      ) : (
        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Type</TableColumnHeader>
              <TableColumnHeader>Scope</TableColumnHeader>
              <TableColumnHeader>Incremental</TableColumnHeader>
              <TableColumnHeader style={{ width: canManage ? 80 : 40 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {applicableHooks.map((hook) => {
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
                    <Flex align="center" justify="end" gap="1">
                      <Tooltip body="View code" usePortal>
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          onClick={() => setViewCodeHook(hook)}
                          aria-label="View hook code"
                        >
                          <PiCode />
                        </IconButton>
                      </Tooltip>
                      {canManage && featureScoped && (
                        <MoreMenu>
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={() => setModalData(hook)}
                          >
                            Edit
                          </a>
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
                          <DeleteButton
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
                        </MoreMenu>
                      )}
                    </Flex>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {hasAccessToCustomHooks && (
        <Box mt="3">
          <Callout status="info">
            Admins can manage global and project-scoped hooks in{" "}
            <Link href="/settings/custom-hooks">
              Settings &gt; Custom Hooks
            </Link>
          </Callout>
        </Box>
      )}
    </Box>
  );
}
