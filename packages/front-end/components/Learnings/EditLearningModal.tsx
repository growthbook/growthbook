import { FC, useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { LearningInterfaceStringDates } from "shared/validators";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MultiSelectField from "@/ui/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";

const EditLearningModal: FC<{
  /** Undefined => create mode, otherwise edit existing. */
  learning?: LearningInterfaceStringDates;
  experiments: ExperimentInterfaceStringDates[];
  /** Default projects to apply when creating from scratch (e.g. current project context). */
  defaultProjects?: string[];
  close: () => void;
  onSaved: () => void;
}> = ({ learning, experiments, defaultProjects, close, onSaved }) => {
  const isNew = !learning;
  const { apiCall } = useAuth();
  const { projects: orgProjects } = useDefinitions();
  const orgSettings = useOrgSettings();
  // Fall back to the defaults when the org hasn't customized the list yet,
  // so the dropdown is never empty for new saved learnings.
  const learningStatuses =
    orgSettings.learningStatuses ?? DEFAULT_LEARNING_STATUSES;
  const [title, setTitle] = useState(learning?.title ?? "");
  const [text, setText] = useState(learning?.text ?? "");
  const [tags, setTags] = useState<string[]>(learning?.tags || []);
  const [projects, setProjects] = useState<string[]>(
    learning?.projects || defaultProjects || [],
  );
  const [supportingIds, setSupportingIds] = useState<string[]>(
    learning?.supportingExperimentIds || [],
  );
  const [contraryIds, setContraryIds] = useState<string[]>(
    learning?.contradictingExperimentIds || [],
  );
  const [status, setStatus] = useState<string>(learning?.status ?? "");

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
      // Wider than the default: this form carries a markdown editor plus four
      // multi-selects, and matches the Find/Refresh Learnings modals.
      size="lg"
      header={isNew ? "New Learning" : "Edit Learning"}
      cta={isNew ? "Create" : "Save"}
      ctaEnabled={title.trim().length > 0}
      trackingEventModalType={isNew ? "new-learning" : "edit-learning"}
      submit={async () => {
        const body = {
          title: title.trim(),
          text,
          tags,
          projects,
          supportingExperimentIds: supportingIds,
          contradictingExperimentIds: contraryIds,
          status,
        };
        if (isNew) {
          await apiCall(`/learnings`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall(`/learnings/${learning!.id}`, {
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
      </Box>
      <Box mb="4">
        <label>Description</label>
        <Box>
          <MarkdownInput
            value={text}
            setValue={setText}
            placeholder="Describe the learning and the evidence behind it"
            showButtons={false}
            hidePreview={false}
          />
        </Box>
      </Box>
      <Box mb="4">
        <label>Tags</label>
        {/* TagsInput autofocuses by default and would steal focus from the
            Title field, which mounts first. */}
        <TagsInput value={tags} onChange={setTags} autoFocus={false} />
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
          placeholder="Select experiments that support this learning"
          value={supportingIds}
          options={supportingOpts}
          onChange={setSupportingIds}
        />
      </Box>
      <Box mb="4">
        <MultiSelectField
          label="Contradicting experiments"
          placeholder="Select experiments that run counter to this learning"
          value={contraryIds}
          options={contraryOpts}
          onChange={setContraryIds}
        />
      </Box>
    </ModalStandard>
  );
};

export default EditLearningModal;
