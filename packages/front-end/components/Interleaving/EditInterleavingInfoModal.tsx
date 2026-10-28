import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import Text from "@/ui/Text";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function EditInterleavingInfoModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const { refreshTags } = useDefinitions();

  const form = useForm({
    defaultValues: {
      name: il.name,
      trackingKey: il.trackingKey,
      owner: il.owner ?? "",
      project: il.project ?? "",
      tags: il.tags,
    },
  });

  // Ask the move question, not just the destination one: can this experiment,
  // where it currently lives, be moved into that project.
  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canUpdateInterleaving(
        { project: il.project },
        { project },
      ),
    il.project ? [il.project] : [],
  );

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-info"
      trackingEventModalSource="interleaving-more-menu"
      header="Edit Info"
      close={close}
      cta="Save"
      size="lg"
      submit={form.handleSubmit(async (data) => {
        if (!data.name.trim()) throw new Error("Name is required");
        if (!data.trackingKey.trim()) {
          throw new Error("Tracking key is required");
        }
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: {
            name: data.name.trim(),
            trackingKey: data.trackingKey.trim(),
            owner: data.owner,
            project: data.project,
            tags: data.tags,
          },
        });
        if (data.tags.length) await refreshTags(data.tags);
        await mutate();
      })}
    >
      <Field label="Name" required minLength={2} {...form.register("name")} />
      <Field
        label="Tracking key"
        helpText="Matched against experiment_id in your Interleaving Exposure Query."
        {...form.register("trackingKey")}
      />
      <SelectOwner
        value={form.watch("owner")}
        onChange={(v) => form.setValue("owner", v)}
      />
      <SelectField
        label="Project"
        value={form.watch("project")}
        onChange={(v) => form.setValue("project", v)}
        options={projectOptions}
        initialOption="All Projects"
      />
      <Box mb="2">
        <Text weight="semibold">Tags</Text>
      </Box>
      <TagsInput
        value={form.watch("tags")}
        onChange={(tags) => form.setValue("tags", tags)}
      />
    </ModalStandard>
  );
}
