import { FC, useState } from "react";
import { ProjectInterface } from "shared/types/project";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const DeleteProjectModal: FC<{
  project: ProjectInterface;
  close: () => void;
  onDeleted: () => void | Promise<void>;
}> = ({ project, close, onDeleted }) => {
  const { apiCall } = useAuth();
  const { organization } = useUser();
  const [deleteResources, setDeleteResources] = useState(true);

  // Sample data has its own endpoint that also clears legacy sample resources,
  // and is always removed with its project.
  const isDemoProject = isDemoDatasourceProject({
    projectId: project.id,
    organizationId: organization?.id,
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header="Delete Project"
      cta="Delete"
      ctaColor="red"
      submit={async () => {
        if (isDemoProject) {
          await apiCall("/demo-datasource-project", { method: "DELETE" });
        } else {
          await apiCall(
            `/projects/${project.id}?deleteResources=${deleteResources ? "true" : "false"}`,
            { method: "DELETE" },
          );
        }
        await onDeleted();
      }}
    >
      <Text as="p">
        Are you sure you want to delete the Project{" "}
        <strong>{project.name}</strong>?
      </Text>
      {!isDemoProject && (
        <>
          <Checkbox
            value={deleteResources}
            setValue={setDeleteResources}
            label="Also delete all of this Project's resources"
            description="Features, experiments, etc."
          />
          {!deleteResources && (
            <Callout status="warning" mt="3">
              You may end up with orphaned resources that will need to be
              cleaned up manually.
            </Callout>
          )}
        </>
      )}
    </ModalStandard>
  );
};

export default DeleteProjectModal;
