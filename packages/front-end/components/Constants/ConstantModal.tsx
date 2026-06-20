import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { ConstantWithoutValue } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import { generateTrackingKey } from "shared/experiments";
import { Box } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectOwner from "@/components/Owner/SelectOwner";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import {
  useConstantDraftTarget,
  ConstantRevisionContext,
} from "@/components/Constants/useConstantDraftTarget";

// Empty context used on the create path, where there is no revision flow.
const EMPTY_REVISION_CTX: ConstantRevisionContext = {
  allRevisions: [],
  openRevisions: [],
  selectedRevision: null,
  approvalRequired: false,
  metadataReviewRequired: false,
  canBypassApproval: false,
};

type FormValues = {
  key: string;
  name: string;
  type: "string" | "json";
  owner: string;
  description: string;
  projects: string[];
  value: string;
};

// Create a constant, or edit its info (name, projects, owner, description).
// The value is edited separately via ConstantValueModal. Edits route through the
// revision system when `revisionMode` is set.
export default function ConstantModal({
  existing,
  close,
  revisionCtx,
  onSaved,
}: {
  existing: ConstantWithoutValue | null;
  close: () => void;
  // Required when editing (info changes route through the revision system).
  revisionCtx?: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void | Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions, getConstantByKey, projects, project } =
    useDefinitions();

  const editing = !!existing;

  // Info edits are metadata-only. Hook is called unconditionally (rules of
  // hooks); on the create path it runs against an empty context and is unused.
  const draft = useConstantDraftTarget(revisionCtx ?? EMPTY_REVISION_CTX, true);

  const form = useForm<FormValues>({
    defaultValues: {
      key: existing?.key ?? "",
      name: existing?.name ?? "",
      type: existing?.type ?? "string",
      // Owner is stored as a userId; backend defaults it to the creator when blank.
      owner: existing?.owner ?? "",
      description: existing?.description ?? "",
      projects: existing?.projects ?? (project ? [project] : []),
      value: "",
    },
  });

  // Auto-derive the slug key from the name until the user edits the key.
  const keyTouched = useRef(editing);
  const name = form.watch("name");
  useEffect(() => {
    if (editing || keyTouched.current || !name) return;
    let active = true;
    generateTrackingKey({ name }, async (k) => getConstantByKey(k)).then(
      (k) => {
        if (active) form.setValue("key", k);
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, editing]);

  const type = form.watch("type");

  const projectOptions = useMemo(
    () => projects.map((p) => ({ label: p.name, value: p.id })),
    [projects],
  );

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="constant-modal"
      header={editing ? "Edit info" : "Add Constant"}
      close={close}
      cta={editing ? "Save" : "Create"}
      submit={form.handleSubmit(async (values) => {
        if (editing && existing) {
          const res = await apiCall<{ revision?: Revision }>(
            `/constants/${existing.id}${draft.buildQueryString()}`,
            {
              method: "PUT",
              body: JSON.stringify({
                name: values.name,
                owner: values.owner,
                description: values.description || undefined,
                projects: values.projects,
              }),
            },
          );
          await mutateDefinitions();
          if (onSaved && res?.revision) {
            await onSaved(res.revision);
          }
        } else {
          if (!values.value) {
            throw new Error("Set a value.");
          }
          await apiCall(`/constants`, {
            method: "POST",
            body: JSON.stringify({
              key: values.key,
              name: values.name,
              owner: values.owner || undefined,
              type: values.type,
              value: values.value,
              projects: values.projects,
            }),
          });
          await mutateDefinitions();
        }
      })}
    >
      {editing && existing && revisionCtx && (
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
          metadataOnly={draft.metadataOnly}
        />
      )}
      <Field label="Name" required {...form.register("name")} />
      <Field
        label="Key"
        required
        helpText={
          <>
            Reference handle used as{" "}
            <code>{`@const:${form.watch("key") || "key"}`}</code>
          </>
        }
        disabled={editing}
        {...form.register("key", {
          onChange: () => {
            keyTouched.current = true;
          },
        })}
      />
      {!editing && (
        <SelectField
          label="Type"
          value={type}
          options={[
            { label: "String", value: "string" },
            { label: "JSON", value: "json" },
          ]}
          onChange={(v) => form.setValue("type", v as "string" | "json")}
        />
      )}

      {projectOptions.length > 0 && (
        <MultiSelectField
          label="Projects"
          value={form.watch("projects")}
          options={projectOptions}
          onChange={(v) => form.setValue("projects", v)}
        />
      )}

      {!editing && (
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
      )}

      {editing && (
        <>
          <SelectOwner
            placeholder="Optional"
            value={form.watch("owner")}
            onChange={(v) => form.setValue("owner", v)}
          />
          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
          />
        </>
      )}
    </ModalStandard>
  );
}
