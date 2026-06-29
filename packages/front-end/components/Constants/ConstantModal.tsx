import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useForm } from "react-hook-form";
import { ConstantWithoutValue } from "shared/types/constant";
import { validateConstantValue } from "shared/validators";
import { Revision } from "shared/enterprise";
import { generateTrackingKey } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectOwner from "@/components/Owner/SelectOwner";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
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
  project: string;
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
  const router = useRouter();
  const { mutateDefinitions, getConstantByKey, projects, project } =
    useDefinitions();

  const editing = !!existing;

  // Description is opt-in behind a "+ Add a description" link, expanded by
  // default when one already exists.
  const [showDescription, setShowDescription] = useState(
    !!existing?.description,
  );

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
      project: existing?.project ?? project ?? "",
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
      size="lg"
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
                project: values.project,
              }),
            },
          );
          await mutateDefinitions();
          if (onSaved && res?.revision) {
            await onSaved(res.revision);
          }
        } else {
          validateConstantValue(values.type, values.value, "Value");
          const res = await apiCall<{ constant: { key: string } }>(
            `/constants`,
            {
              method: "POST",
              body: JSON.stringify({
                key: values.key,
                name: values.name,
                owner: values.owner || undefined,
                type: values.type,
                // Empty is allowed: a string sends "", JSON omits the field
                // entirely (treated as "no value").
                ...(values.type === "json" && !values.value
                  ? {}
                  : { value: values.value }),
                description: values.description || undefined,
                project: values.project || undefined,
              }),
            },
          );
          await mutateDefinitions();
          if (res?.constant?.key) {
            await router.push(`/constants/${res.constant.key}`);
          }
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
            Referenced as{" "}
            <code>
              {type === "json"
                ? `"$extends": ["@const:${form.watch("key") || "key"}"]`
                : `{{ @const:${form.watch("key") || "key"} }}`}
            </code>
          </>
        }
        disabled={editing}
        {...form.register("key", {
          onChange: () => {
            keyTouched.current = true;
          },
        })}
      />

      {showDescription ? (
        <Box mb="3">
          <Box mb="1">
            <Text as="label" weight="semibold">
              Description
            </Text>
          </Box>
          <MarkdownInput
            value={form.watch("description")}
            setValue={(v) => form.setValue("description", v)}
            placeholder="Add notes about this constant (markdown supported)"
            showButtons={false}
            hidePreview={false}
          />
        </Box>
      ) : (
        <Link
          mb="3"
          onClick={(e) => {
            e.preventDefault();
            setShowDescription(true);
          }}
        >
          <Flex align="center" gap="1">
            <PiPlus />
            <Text weight="medium">Add a description</Text>
          </Flex>
        </Link>
      )}

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
        <SelectField
          label="Project"
          value={form.watch("project")}
          options={projectOptions}
          initialOption="All Projects"
          onChange={(v) => form.setValue("project", v)}
        />
      )}

      {!editing && (
        <FeatureValueField
          label="Value"
          id="constant-value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={type}
          useCodeInput={type === "json"}
          showFullscreenButton={type === "json"}
          // A new constant can't be referenced yet (no cycles possible); just
          // scrub a self-reference to the key being created.
          constantContext={{
            project: form.watch("project") || undefined,
            excludeKeys: [form.watch("key")],
          }}
        />
      )}

      {editing && (
        <SelectOwner
          placeholder="Optional"
          value={form.watch("owner")}
          onChange={(v) => form.setValue("owner", v)}
        />
      )}
    </ModalStandard>
  );
}
