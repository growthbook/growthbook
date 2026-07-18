import React, { FC, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { PiCaretDownFill } from "react-icons/pi";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { deleteDemoDatasource } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

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
  const [open, setOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    setError(null);
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
              <div style={{ maxWidth: 360 }}>
                <p>If you are done with this sample data, delete it here.</p>
                {error && (
                  <Callout status="error" mb="2">
                    {error}
                  </Callout>
                )}
                <Button color="red" onClick={handleDelete}>
                  Delete Sample Data
                </Button>
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
