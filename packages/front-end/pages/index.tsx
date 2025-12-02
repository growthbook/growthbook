import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { ProjectInterface } from "back-end/types/project";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useFeaturesList } from "@/services/features";
import GetStartedAndHomePage from "@/components/GetStarted";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { isCloud } from "@/services/env";

export default function Home(): React.ReactElement {
  const router = useRouter();
  const gb = useGrowthBook();
  const { projectId: demoDataSourceProjectId, demoExperimentId } =
    useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { mutateDefinitions, setProject } = useDefinitions();
  const { organization, email } = useUser();

  // Welcome modal logic - only show to org creator on first visit
  const [hasSeenWelcomeModal, _setHasSeenWelcomeModal] =
    useLocalStorage<boolean>("welcome-modal-shown", false);
  const [sampleDataLoading, setSampleDataLoading] = useState(false);

  // Check if current user is the organization creator
  const isOrgCreator = organization?.ownerEmail === email;

  const openSampleExperimentResults = async () => {
    setSampleDataLoading(true);
    if (demoDataSourceProjectId && demoExperimentId) {
      setSampleDataLoading(false);
      router.push(`/experiment/${demoExperimentId}#results`);
    } else {
      track("Create Sample Project", {
        source: "home-page",
      });
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>(
        gb.isOn("new-sample-data")
          ? "/demo-datasource-project/new"
          : "/demo-datasource-project",
        {
          method: "POST",
        },
      );
      await mutateDefinitions();
      if (res.experimentId) {
        setProject(res.project.id);
        setSampleDataLoading(false);
        router.push(`/experiment/${res.experimentId}#results`);
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };
  const {
    experiments,
    loading: experimentsLoading,
    error: experimentsError,
  } = useExperiments();

  const {
    features,
    loading: featuresLoading,
    error: featuresError,
  } = useFeaturesList(false);

  useEffect(() => {
    if (!organization) return;
    if (featuresLoading || experimentsLoading) {
      return;
    }

    const demoProjectId = getDemoDatasourceProjectIdForOrganization(
      organization.id || "",
    );

    // has features and experiments that are not demo projects
    const hasFeatures = features.some((f) => f.project !== demoProjectId);
    const hasExperiments = experiments.some((e) => e.project !== demoProjectId);
    const hasFeatureOrExperiment = hasFeatures || hasExperiments;
    if (!hasFeatureOrExperiment) {
      if (
        !organization.isVercelIntegration &&
        organization.demographicData?.ownerJobTitle === "engineer"
      ) {
        router.replace("/setup");
      } else if (
        isOrgCreator &&
        !hasSeenWelcomeModal &&
        isCloud() &&
        organization.demographicData?.ownerJobTitle !== "engineer"
      ) {
        openSampleExperimentResults();
      } else {
        router.replace("/getstarted");
      }
    }
  }, [
    organization,
    features.length,
    experiments.length,
    featuresLoading,
    experimentsLoading,
  ]);

  if (experimentsError || featuresError) {
    return (
      <div className="alert alert-danger">
        {experimentsError?.message ||
          featuresError?.message ||
          "An error occurred"}
      </div>
    );
  }
  return featuresLoading || experimentsLoading || sampleDataLoading ? (
    <LoadingOverlay />
  ) : (
    <GetStartedAndHomePage />
  );
}
