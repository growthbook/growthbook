import { FeatureInterface } from "shared/types/feature";
import { CustomHookInterface } from "shared/validators";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import JSONValidation from "@/components/Features/JSONValidation";
import CustomHookModal from "@/components/Features/CustomHookModal";

export default function FeatureValidationTab({
  feature,
  mutate,
  setVersion,
  revisionList,
}: {
  feature: FeatureInterface;
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
          <CustomHooksSection feature={feature} />
        </Frame>
      )}
    </div>
  );
}

function CustomHooksSection({ feature }: { feature: FeatureInterface }) {
  const { hasCommercialFeature, settings } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const [modalData, setModalData] = useState<null | true | CustomHookInterface>(
    null,
  );

  const hasCustomHooks = hasCommercialFeature("custom-hooks");

  const { data, mutate } = useApi<{ customHooks: CustomHookInterface[] }>(
    "/custom-hooks",
    { shouldRun: () => hasCustomHooks },
  );

  const canManage = permissionsUtil.canManageFeatureCustomHooks(
    feature,
    !!settings.allowPerFeatureCustomHooks,
  );

  const allHooks = data?.customHooks || [];
  // Global/project hooks that also apply to this feature (read-only here)
  const inheritedHooks = allHooks.filter(
    (h) =>
      !h.entityType &&
      (!h.projects.length || h.projects.includes(feature.project || "")),
  );
  // Hooks scoped specifically to this feature
  const featureHooks = allHooks.filter(
    (h) => h.entityType === "feature" && h.entityId === feature.id,
  );

  return (
    <Box>
      {modalData && (
        <CustomHookModal
          current={modalData === true ? undefined : modalData}
          feature={feature}
          close={() => setModalData(null)}
          onSave={() => mutate()}
        />
      )}
      <Flex align="center" gap="1" mb="1">
        <Heading as="h3" size="medium" mb="0">
          Custom Hooks
        </Heading>
        {hasCustomHooks && canManage && (
          <div className="ml-auto">
            <Button onClick={() => setModalData(true)}>Add Custom Hook</Button>
          </div>
        )}
      </Flex>
      <Box mb="3">
        <em className="text-muted">
          Run sandboxed JavaScript validation before this feature is saved.
        </em>
      </Box>

      {!hasCustomHooks ? (
        <Callout status="info">
          Custom Hooks require an Enterprise plan.
        </Callout>
      ) : (
        <>
          <Heading as="h4" size="small" mb="1">
            Scoped to this feature
          </Heading>
          {featureHooks.length === 0 ? (
            <p className="text-muted">No hooks scoped to this feature yet.</p>
          ) : (
            <table className="gbtable table appbox">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Enabled</th>
                  {canManage && <th style={{ width: 50 }}></th>}
                </tr>
              </thead>
              <tbody>
                {featureHooks.map((hook) => (
                  <tr key={hook.id}>
                    <td data-title="Name">{hook.name}</td>
                    <td data-title="Type">{hook.hook}</td>
                    <td data-title="Enabled">{hook.enabled ? "Yes" : "No"}</td>
                    {canManage && (
                      <td>
                        <MoreMenu>
                          <a
                            href="#"
                            className="dropdown-item"
                            onClick={() => setModalData(hook)}
                          >
                            Edit
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {inheritedHooks.length > 0 && (
            <Box mt="4">
              <Heading as="h4" size="small" mb="1">
                Inherited (global &amp; project)
              </Heading>
              <p className="text-muted">
                These hooks apply to this feature but are managed in Settings →
                Custom Hooks.
              </p>
              <table className="gbtable table appbox">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {inheritedHooks.map((hook) => (
                    <tr key={hook.id}>
                      <td data-title="Name">{hook.name}</td>
                      <td data-title="Type">{hook.hook}</td>
                      <td data-title="Scope">
                        {hook.projects.length
                          ? "Specific projects"
                          : "All projects"}
                      </td>
                      <td data-title="Enabled">
                        {hook.enabled ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
