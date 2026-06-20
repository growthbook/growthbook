import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import { filterProjectsByEnvironment } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDownFill, PiPlus, PiTrash } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import {
  useConstantDraftTarget,
  ConstantRevisionContext,
} from "@/components/Constants/useConstantDraftTarget";

type FormValues = {
  value: string;
  // Override env id → value. A key's presence means an override exists (even
  // while its value is still being typed).
  environmentValues: Record<string, string>;
};

// Dedicated editor for a constant's value (default + per-environment overrides).
// Routed through the revision system via the draft selector at the top.
export default function ConstantValueModal({
  existing,
  full,
  revisionCtx,
  onSaved,
  close,
}: {
  existing: ConstantWithoutValue;
  // Current value state to prefill (e.g. the selected revision's patched state).
  full: ConstantInterface;
  revisionCtx: ConstantRevisionContext;
  onSaved: (revision: Revision) => void | Promise<void>;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const environments = useEnvironments();

  // Value is a content edit (not metadata-only).
  const draft = useConstantDraftTarget(revisionCtx, false);

  const type = existing.type;

  // Only offer environments allowed by the constant's project scoping. A global
  // constant (no projects) can override any environment.
  const allowedEnvironments = useMemo(() => {
    const projects = full.projects ?? [];
    if (projects.length === 0) return environments;
    return environments.filter(
      (env) => filterProjectsByEnvironment(projects, env).length > 0,
    );
  }, [environments, full.projects]);

  const form = useForm<FormValues>({
    defaultValues: {
      value: "",
      environmentValues: {},
    },
  });

  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    form.setValue("value", full.value ?? "");
    form.setValue("environmentValues", full.environmentValues ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  const envValues = form.watch("environmentValues") || {};

  // Show override rows only for allowed envs (in env order); offer the rest in
  // the "add" dropdown.
  const overrideEnvIds = allowedEnvironments
    .map((e) => e.id)
    .filter((id) => id in envValues);
  const addableEnvs = allowedEnvironments.filter((e) => !(e.id in envValues));

  const addOverride = (envId: string) => {
    form.setValue("environmentValues", {
      ...form.getValues("environmentValues"),
      [envId]: "",
    });
  };
  const removeOverride = (envId: string) => {
    const next = { ...form.getValues("environmentValues") };
    delete next[envId];
    form.setValue("environmentValues", next);
  };
  const setOverrideValue = (envId: string, v: string) => {
    form.setValue("environmentValues", {
      ...form.getValues("environmentValues"),
      [envId]: v,
    });
  };

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="constant-value-modal"
      header="Edit value"
      size="lg"
      close={close}
      cta="Save"
      submit={form.handleSubmit(async (values) => {
        const environmentValues: Record<string, string> = {};
        for (const [envId, v] of Object.entries(values.environmentValues)) {
          if (v) environmentValues[envId] = v;
        }

        if (!values.value && Object.keys(environmentValues).length === 0) {
          throw new Error("Set a value or at least one environment override.");
        }

        // The PUT controller treats `undefined` as "field untouched", so an
        // empty value/overrides would be silently ignored — meaning a cleared
        // override never lands. Send explicit empties (`""` / `{}`) when the
        // field previously had content so the clear is detected as a change;
        // otherwise send `undefined` to avoid a spurious no-op change.
        const hadValue = !!full.value;
        const hadOverrides =
          Object.keys(full.environmentValues ?? {}).length > 0;

        const res = await apiCall<{ revision?: Revision }>(
          `/constants/${existing.id}${draft.buildQueryString()}`,
          {
            method: "PUT",
            body: JSON.stringify({
              value: values.value || (hadValue ? "" : undefined),
              environmentValues: Object.keys(environmentValues).length
                ? environmentValues
                : hadOverrides
                  ? {}
                  : undefined,
            }),
          },
        );
        await mutateDefinitions();
        if (res?.revision) await onSaved(res.revision);
      })}
    >
      <ConstantDraftSelectorForChanges
        constantId={existing.id}
        openRevisions={revisionCtx.openRevisions}
        allRevisions={revisionCtx.allRevisions}
        mode={draft.draftMode}
        setMode={draft.setDraftMode}
        selectedDraftId={draft.draftSelectedId}
        setSelectedDraftId={draft.setDraftSelectedId}
        canAutoPublish={draft.canAutoPublish}
        approvalRequired={draft.selectorApprovalRequired}
      />

      <Box mb="3">
        <FeatureValueField
          label="Value"
          id="constant-value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={type}
          useCodeInput={type === "json"}
        />
      </Box>

      {allowedEnvironments.length > 0 && (
        <Box mb="3">
          <Flex align="center" justify="between" mb="4">
            <Text as="div" weight="semibold">
              Environment overrides
            </Text>
            {addableEnvs.length > 0 && (
              <DropdownMenu
                menuPlacement="end"
                trigger={
                  <Button variant="outline" size="sm">
                    <Flex align="center" gap="1">
                      <PiPlus /> Add override <PiCaretDownFill size={10} />
                    </Flex>
                  </Button>
                }
              >
                {addableEnvs.map((e) => (
                  <DropdownMenuItem
                    key={e.id}
                    onClick={() => addOverride(e.id)}
                  >
                    {e.id}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}
          </Flex>
          {overrideEnvIds.length === 0 ? (
            <Text as="div" size="small" color="text-mid">
              No overrides yet.
            </Text>
          ) : (
            overrideEnvIds.map((envId) => (
              <Box key={envId} mb="3">
                <Flex align="center" justify="between" mb="1">
                  <Text weight="medium">{envId}</Text>
                  <IconButton
                    variant="ghost"
                    color="red"
                    size="2"
                    radius="full"
                    onClick={() => removeOverride(envId)}
                    aria-label={`Remove ${envId} override`}
                  >
                    <PiTrash size={16} />
                  </IconButton>
                </Flex>
                <FeatureValueField
                  id={`constant-env-${envId}`}
                  value={envValues[envId] || ""}
                  setValue={(v) => setOverrideValue(envId, v)}
                  valueType={type}
                  useCodeInput={type === "json"}
                />
              </Box>
            ))
          )}
        </Box>
      )}
    </ModalStandard>
  );
}
