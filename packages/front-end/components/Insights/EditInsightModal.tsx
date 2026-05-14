import { FC, useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import TagsInput from "@/components/Tags/TagsInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

type FrontEndInsight = {
  id: string;
  title: string;
  text: string;
  tags?: string[];
  projects?: string[];
  supportingExperimentIds: string[];
  contraryEvidence?: string[];
};

const EditInsightModal: FC<{
  /** Undefined => create mode, otherwise edit existing. */
  insight?: FrontEndInsight;
  experiments: ExperimentInterfaceStringDates[];
  /** Default projects to apply when creating from scratch (e.g. current project context). */
  defaultProjects?: string[];
  close: () => void;
  onSaved: () => void;
}> = ({ insight, experiments, defaultProjects, close, onSaved }) => {
  const isNew = !insight;
  const { apiCall } = useAuth();
  const { projects: orgProjects } = useDefinitions();
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
