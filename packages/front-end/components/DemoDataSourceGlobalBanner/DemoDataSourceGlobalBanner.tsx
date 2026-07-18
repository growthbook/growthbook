import React, { FC, useCallback, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { PiCaretDownFill } from "react-icons/pi";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { AuthContextValue, useAuth } from "@/services/auth";
import track from "@/services/track";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

export async function deleteDemoDatasource(
  apiCall: AuthContextValue["apiCall"],
) {
  await apiCall(`/demo-datasource-project`, {
    method: "DELETE",
  });
}

export async function resetDemoDatasource(
  apiCall: AuthContextValue["apiCall"],
) {
  await apiCall(`/demo-datasource-project/reset`, {
    method: "POST",
  });
}

type DemoDataSourceGlobalBannerProps = {
  ready: boolean;
  currentProjectIsDemo: boolean;
  demoProjectId: string;
  onDeleted?: () => void;
};

export const DemoDataSourceGlobalBanner: FC<
  DemoDataSourceGlobalBannerProps
> = ({ ready, currentProjectIsDemo, demoProjectId, onDeleted }) => {
  const { apiCall } = useAuth();
  const { mutateDefinitions, project, projects, setProject } = useDefinitions();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    setError(null);
    setSuccess(null);
    try {
      track("Delete Sample Project", { source: "global-banner" });
      await deleteDemoDatasource(apiCall);
      mutateDefinitions();
      if (project === demoProjectId) {
        const nextProject =
          projects.find((p) => p.id !== demoProjectId)?.id ?? "";
        setProject(nextProject);
      }
      setOpen(false);
      // Avoid stranding the user on a now-deleted resource page (e.g. the
      // sample experiment) — send them home.
      router.push("/");
      onDeleted?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to delete sample data.",
      );
    }
  }, [
    apiCall,
    demoProjectId,
    mutateDefinitions,
    onDeleted,
    project,
    projects,
    router,
    setProject,
  ]);

  const handleReset = useCallback(async () => {
    setError(null);
    setSuccess(null);
    try {
      track("Reset Sample Project", { source: "global-banner" });
      await resetDemoDatasource(apiCall);
      mutateDefinitions();
      setSuccess("Sample data was reset to its original state.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset sample data.");
    }
  }, [apiCall, mutateDefinitions]);

  if (!ready || !currentProjectIsDemo) {
    return null;
  }

  return (
    <div className="demo-datasource-banner__wrapper">
      <div className="demo-datasource-banner">
        <div className="demo-datasource-banner__line" />

        <div className="demo-datasource-banner__text-wrapper">
          <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={
              <button
                type="button"
                className="demo-datasource-banner__text text-white"
              >
                Sample Data
                <PiCaretDownFill
                  style={{ marginLeft: 4, verticalAlign: "-2px" }}
                />
              </button>
            }
            content={
              <div style={{ maxWidth: 380 }}>
                <p>
                  Mess something up? Reset it. Delete when you&apos;re done.
                </p>
                {error && (
                  <Callout status="error" mb="2">
                    {error}
                  </Callout>
                )}
                {success && (
                  <Callout status="success" mb="2">
                    {success}
                  </Callout>
                )}
                <Flex gap="2">
                  <Button variant="outline" onClick={handleReset}>
                    Reset Sample Data
                  </Button>
                  <Button color="red" onClick={handleDelete}>
                    Delete Sample Data
                  </Button>
                </Flex>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
};

export const DemoDataSourceGlobalBannerContainer = () => {
  const { orgId } = useAuth();
  const { project, ready } = useDefinitions();

  const demoProjectId = useMemo(
    () => (orgId ? getDemoDatasourceProjectIdForOrganization(orgId) : ""),
    [orgId],
  );

  const currentProjectIsDemo = !!demoProjectId && project === demoProjectId;

  return (
    <DemoDataSourceGlobalBanner
      ready={ready}
      currentProjectIsDemo={currentProjectIsDemo}
      demoProjectId={demoProjectId}
    />
  );
};
