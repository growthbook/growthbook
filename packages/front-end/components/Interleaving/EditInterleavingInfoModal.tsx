import { useForm } from "react-hook-form";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { interleavingInSDKPayload } from "shared/util";
import {
  holdsInterleavingMoveDestination,
  interleavingEnvsForChange,
} from "shared/permissions";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import TagsInput from "@/components/Tags/TagsInput";
import SelectOwner from "@/components/Owner/SelectOwner";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";

export default function EditInterleavingInfoModal({
  interleaving: il,
  canEditServing,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  // Project reaches the SDK payload, so the server wants run permission for
  // it once this is serving.
  canEditServing: boolean;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const { refreshTags } = useDefinitions();

  const form = useForm({
    defaultValues: {
      name: il.name,
      owner: il.owner ?? "",
      project: il.project ?? "",
      tags: il.tags,
    },
  });

  const environments = useEnvironments();
  const moveScope = {
    ...il,
    serving: interleavingInSDKPayload(il),
  };
  const changeEnvs = interleavingEnvsForChange({
    existing: il,
    environmentIds: environments.map((e) => e.id),
  });

  // Ask the move question, not just the destination one: can this experiment,
  // where it currently lives, be moved into that project.
  const projectOptions = useProjectOptions(
    (project) =>
      holdsInterleavingMoveDestination(
        permissionsUtil,
        moveScope,
        project,
        changeEnvs,
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
      submit={validatedSubmit(form, async (data) => {
        if (!data.name.trim()) throw new Error("Name is required");
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: {
            name: data.name.trim(),
            // A stored owner who has left the org fails the server's membership
            // check, which would block an unrelated name or tag edit.
            owner: data.owner !== (il.owner ?? "") ? data.owner : undefined,
            // Similarly only send project if it is changed
            project:
              data.project !== (il.project ?? "") ? data.project : undefined,
            tags: data.tags,
          },
        });
        if (data.tags.length) await refreshTags(data.tags);
        await mutate();
      })}
    >
      <Field label="Name" required minLength={2} {...form.register("name")} />
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
        disabled={!canEditServing}
      />
      <TagsInput
        label="Tags"
        autoFocus={false}
        value={form.watch("tags")}
        onChange={(tags) => form.setValue("tags", tags)}
      />
    </ModalStandard>
  );
}
