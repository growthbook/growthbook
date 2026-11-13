import { useState } from "react";
import { FactTableInterface } from "shared/types/fact-table";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import track from "@/services/track";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import { TextField } from "@/ui/TextField";
import Text from "@/ui/Text";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import TagsInput from "@/components/Tags/TagsInput";

// Edits a Fact Table's details. NewFactTableModal edits its SQL and mapping.
export default function FactTableDetailsModal({
  factTable,
  close,
}: {
  factTable: FactTableInterface;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const [name, setName] = useState(factTable.name);
  const [description, setDescription] = useState(factTable.description || "");
  const [owner, setOwner] = useState(factTable.owner || "");
  const [projects, setProjects] = useState(factTable.projects || []);
  const [tags, setTags] = useState(factTable.tags || []);

  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canUpdateFactTable({ projects: [project] }, {}),
    factTable.projects || [],
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      header="Edit details"
      close={close}
      cta="Save"
      ctaEnabled={!!name.trim()}
      submit={async () => {
        await apiCall(`/fact-tables/${factTable.id}`, {
          method: "PUT",
          body: JSON.stringify({ name, description, owner, projects, tags }),
        });
        track("Edit Fact Table", { source: "edit-details" });
        await mutateDefinitions();
      }}
    >
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        autoFocus
      />
      <Box my="3">
        <Text
          as="label"
          htmlFor="fact-table-description"
          weight="semibold"
          mb="1"
        >
          Description
        </Text>
        <MarkdownInput
          id="fact-table-description"
          value={description}
          setValue={setDescription}
        />
      </Box>
      <SelectOwner value={owner} onChange={setOwner} />
      <MultiSelectField
        legacyHeight
        label="Projects"
        placeholder="All Projects"
        value={projects}
        options={projectOptions}
        onChange={setProjects}
        customClassName="label-overflow-ellipsis"
      />
      <TagsInput
        label="Tags"
        value={tags}
        onChange={setTags}
        autoFocus={false}
      />
    </ModalStandard>
  );
}
