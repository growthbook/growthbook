import { ProjectInterface } from "shared/types/project";
import { useRouter } from "next/router";
import { Trans } from "@lingui/react/macro";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";

const ViewSampleDataButton = ({
  resource = "experiment",
}: {
  resource?: "experiment" | "feature";
}) => {
  const { demoExperimentId, demoFeatureId, exists } =
    useDemoDataSourceProject();
  const router = useRouter();
  const { apiCall } = useAuth();

  const permissionsUtils = usePermissionsUtil();

  const { mutateDefinitions } = useDefinitions();

  const openSample = async () => {
    if (exists && demoExperimentId) {
      if (resource === "experiment") {
        router.push(`/experiment/${demoExperimentId}`);
      } else {
        router.push(`/features/${demoFeatureId}`);
      }
    } else {
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>("/demo-datasource-project", {
        method: "POST",
      });
      track("Create Sample Project", {
        source: "get-started",
      });
      await mutateDefinitions();
      if (res.experimentId) {
        if (resource === "experiment") {
          router.push(`/experiment/${res.experimentId}`);
        } else {
          router.push(`/features/${demoFeatureId}`);
        }
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };

  return (
    <Button
      variant="outline"
      onClick={openSample}
      disabled={
        (!exists || !demoExperimentId) && !permissionsUtils.canCreateProjects()
      }
    >
      {resource === "experiment" ? (
        <Trans>View Sample Experiment</Trans>
      ) : (
        <Trans>View Sample Feature</Trans>
      )}
    </Button>
  );
};

export default ViewSampleDataButton;
