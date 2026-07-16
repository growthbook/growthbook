import { FC, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { InsightInterfaceStringDates } from "shared/validators";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import Badge from "@/ui/Badge";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";

const EditInsightModal: FC<{
  /** Undefined => create mode, otherwise edit existing. */
  insight?: InsightInterfaceStringDates;
  experiments: ExperimentInterfaceStringDates[];
  /** Default projects to apply when creating from scratch (e.g. current project context). */
  defaultProjects?: string[];
  close: () => void;
  onSaved: () => void;
}> = ({ insight, experiments, defaultProjects, close, onSaved }) => {
  const isNew = !insight;
  const { apiCall } = useAuth();
  const { projects: orgProjects } = useDefinitions();
  const orgSettings = useOrgSettings();
  // Fall back to the defaults when the org hasn't customized the list yet,
  // so the dropdown is never empty for new saved learnings.
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
  const [title, setTitle] = useState(insight?.title ?? "");
  const [text, setText] = useState(insight?.text ?? "");
  const [tags, setTags] = useState<string[]>(insight?.tags || []);
  const [projects, setProjects] = useState<string[]>(
    insight?.projects || defaultProjects || [],
  );
  const [supportingIds, setSupportingIds] = useState<string[]>(
    insight?.supportingExperimentIds || [],
  );
  const [contraryIds, setContraryIds] = useState<string[]>(
    insight?.contraryEvidence || [],
  );
  const [status, setStatus] = useState<string>(insight?.status ?? "");

  const statusOptions = useMemo(() => {
    const opts = [{ label: "No status", value: "" }];
    learningStatuses.forEach((s) => opts.push({ label: s.label, value: s.id }));
    // If the saved status is no longer in the configured list (e.g. it was
    // deleted), still keep the raw id selected so the user can clearly see
    // and change it.
    if (status && !learningStatuses.some((s) => s.id === status)) {
      opts.push({ label: `${status} (deleted)`, value: status });
    }
    return opts;
  }, [learningStatuses, status]);

  const selectedStatusObject = useMemo(
    () => learningStatuses.find((s) => s.id === status),
    [learningStatuses, status],
  );

  const projectOptions = orgProjects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  // Build experiment options. Include any ids that are currently selected
  // but no longer in the experiments list (e.g. archived) so the user can
  // still see and remove them.
  const experimentOptions = useMemo(() => {
    const byId = new Map(experiments.map((e) => [e.id, e.name]));
    const seen = new Set<string>();
    const opts: { label: string; value: string }[] = [];
    experiments.forEach((e) => {
      seen.add(e.id);
      opts.push({ label: e.name || e.id, value: e.id });
    });
    [...supportingIds, ...contraryIds].forEach((id) => {
      if (!seen.has(id)) {
        opts.push({ label: byId.get(id) || id, value: id });
        seen.add(id);
      }
    });
    return opts;
  }, [experiments, supportingIds, contraryIds]);

  // Don't let the same experiment be on both lists.
  const supportingSet = new Set(supportingIds);
  const contrarySet = new Set(contraryIds);
  const supportingOpts = experimentOptions.filter(
    (o) => !contrarySet.has(o.value),
  );
  const contraryOpts = experimentOptions.filter(
    (o) => !supportingSet.has(o.value),
  );

  return (
    <ModalStandard
      open={true}
      close={close}
      header={isNew ? "New saved learning" : "Edit insight"}
      cta={isNew ? "Create" : "Save"}
      ctaEnabled={title.trim().length > 0}
      trackingEventModalType={isNew ? "new-insight" : "edit-insight"}
      submit={async () => {
        const body = {
          title: title.trim(),
          text,
          tags,
          projects,
          supportingExperimentIds: supportingIds,
          contraryEvidence: contraryIds,
          status,
        };
        if (isNew) {
          await apiCall(`/insights`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall(`/insights/${insight!.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        }
        onSaved();
      }}
    >
      <Box mb="4">
        <Field
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
        />
      </Box>
      <Box mb="4">
        <SelectField
          label="Status"
          value={status}
          options={statusOptions}
          onChange={(v) => setStatus(v)}
          sort={false}
        />
        {selectedStatusObject && (
          <Flex mt="2" gap="2" align="center">
            <Badge
              label={selectedStatusObject.label}
              color={selectedStatusObject.color || "gray"}
              variant="soft"
              size="sm"
            />
          </Flex>
        )}
      </Box>
      <Box mb="4">
        <label>Description</label>
        <Box>
          <MarkdownInput
            value={text}
            setValue={setText}
            placeholder="Describe the insight and the evidence behind it"
            showButtons={false}
            hidePreview={false}
          />
        </Box>
      </Box>
      <Box mb="4">
        <label>Tags</label>
        <TagsInput value={tags} onChange={setTags} />
      </Box>
      {orgProjects.length > 0 && (
        <Box mb="4">
          <MultiSelectField
            label="Projects"
            placeholder="All projects"
            value={projects}
            options={projectOptions}
            onChange={setProjects}
            customClassName="label-overflow-ellipsis"
          />
        </Box>
      )}
      <Box mb="4">
        <MultiSelectField
          label="Supporting experiments"
          placeholder="Select experiments that support this insight"
          value={supportingIds}
          options={supportingOpts}
          onChange={setSupportingIds}
        />
      </Box>
      <Box mb="4">
        <MultiSelectField
          label="Contrary evidence"
          placeholder="Select experiments that run counter to this insight"
          value={contraryIds}
          options={contraryOpts}
          onChange={setContraryIds}
        />
      </Box>
    </ModalStandard>
  );
};

export default EditInsightModal;
