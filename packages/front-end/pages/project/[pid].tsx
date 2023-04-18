import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { ProjectInterface } from "back-end/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import Button from "@/components/Button";
import TempMessage from "@/components/TempMessage";
import useOrgSettings from "@/hooks/useOrgSettings";
import ProjectModal from "@/components/Projects/ProjectModal";
import MemberList from "@/components/Settings/Team/MemberList";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";

// todo: use proper interface
/* eslint-disable @typescript-eslint/no-explicit-any */
type ProjectSettings = any;

function hasChanges(value: ProjectSettings, existing: ProjectSettings) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const settings: ProjectSettings = {};

const ProjectPage: FC = () => {
  const { getProjectById, mutateDefinitions, ready, error } = useDefinitions();
  const { pid } = router.query as { pid: string };
  const p = getProjectById(pid);
  // const settings = p?.settings;
  // todo: replace with project settings (above)
  // const settings: ProjectSettings = {};

  // todo: use scope function to get defaults
  const orgSettings = useOrgSettings();

  // const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<ProjectSettings>({});

  const permissions = usePermissions();
  const canEditSettings = permissions.check("manageProjects", pid);
  // todo: should this also be project scoped?
  const canManageTeam = permissions.check("manageTeam");

  const form = useForm<ProjectSettings>({
    defaultValues: {
      statsEngine: settings?.statsEngine || "",
    },
  });

  useEffect(() => {
    if (settings) {
      const newVal = { ...form.getValues() };
      Object.keys(newVal).forEach((k) => {
        const hasExistingMetrics = typeof settings?.[k] !== "undefined";
        newVal[k] = settings?.[k] || newVal[k];

        // Existing values are stored as a multiplier, e.g. 50% on the UI is stored as 0.5
        // Transform these values from the UI format
        if (k === "metricDefaults" && hasExistingMetrics) {
          newVal.metricDefaults = {
            ...newVal.metricDefaults,
            maxPercentageChange:
              newVal.metricDefaults.maxPercentageChange * 100,
            minPercentageChange:
              newVal.metricDefaults.minPercentageChange * 100,
          };
        }
        if (k === "confidenceLevel" && newVal?.confidenceLevel <= 1) {
          newVal.confidenceLevel = newVal.confidenceLevel * 100;
        }
      });
      form.reset(newVal);
      setOriginalValue(newVal);
    }
    //eslint-disable-next-line
  }, [settings, form]);

  const value = form.getValues();

  const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
    const transformedProjectSettings = {
      ...value,
      metrics: {
        ...value.metrics,
        maxPercentageChange: value.metrics.maxPercentageChange / 100,
        minPercentageChange: value.metrics.minPercentageChange / 100,
      },
      experiments: {
        bayesian: {
          confidenceLevel: value.experiments.bayesian.confidenceLevel / 100,
        },
      },
    };
    console.log("save", transformedProjectSettings);

    // await apiCall(`/organization`, {
    //   method: "PUT",
    //   body: JSON.stringify({
    //     settings: transformedProjectSettings,
    //   }),
    // });

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  if (!canEditSettings) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!p) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Project <code>{pid}</code> does not exist.
        </div>
      </div>
    );
  }

  return (
    <>
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <div className="container pagecontents">
        <div className="mb-2">
          <Link href="/projects">
            <a>
              <GBCircleArrowLeft /> Back to all projects
            </a>
          </Link>
        </div>
        <div className="d-flex align-items-center mb-2">
          <h1 className="mb-0">{p.name}</h1>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <div className="d-flex align-items-center mb-2">
          <div className="text-gray">{p.description}</div>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <h2 className="mt-4 mb-0">Project Team Members</h2>
        <div className="mb-4">
          <MemberList
            mutate={refreshOrganization}
            project={pid}
            canEditRoles={canManageTeam}
            canDeleteMembers={false}
            canInviteMembers={false}
            maxHeight={500}
          />
        </div>

        <h2 className="mt-4 mb-4">Project Settings</h2>
        {saveMsg && (
          <TempMessage
            close={() => {
              setSaveMsg(false);
            }}
          >
            Settings saved
          </TempMessage>
        )}
        {/*<div className="text-muted mb-4">*/}
        {/*  Override organization-wide settings for this project. Leave fields*/}
        {/*  blank to use the organization default.*/}
        {/*</div>*/}
        <div className="bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>Experiment Settings</h4>
            </div>
            <div className="col-sm-9">
              <StatsEngineSelect
                form={form}
                scope={orgSettings}
                currentScope="project"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0 }}
      >
        <div className="container-fluid pagecontents d-flex flex-row-reverse">
          <Button
            style={{ marginRight: "4rem" }}
            color={"primary"}
            disabled={!ctaEnabled}
            onClick={async () => {
              if (!ctaEnabled) return;
              await saveSettings();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
};

export default ProjectPage;
