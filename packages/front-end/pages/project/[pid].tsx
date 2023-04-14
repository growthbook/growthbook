import React, { FC } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FaQuestionCircle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";

// todo: use proper interface
/* eslint-disable @typescript-eslint/no-explicit-any */
type ProjectSettings = any;

const ProjectPage: FC = () => {
  const {
    getProjectById,
    // mutateDefinitions,
    ready,
    error,
  } = useDefinitions();
  const { pid } = router.query as { pid: string };
  const p = getProjectById(pid);
  // const s = p?.settings;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const s: any = {};

  const permissions = usePermissions();
  const canEdit = permissions.check("manageProjects", pid);

  const form = useForm<ProjectSettings>({
    defaultValues: {
      multipleExposureMinPercent: s?.multipleExposureMinPercent,
      attributionModel: s?.attributionModel || "",
      statsEngine: s?.statsEngine || "",
    },
  });

  if (!canEdit) {
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
    <div className="container pagecontents">
      <div className="mb-2">
        <Link href="/projects">
          <a>
            <GBCircleArrowLeft /> Back to all projects
          </a>
        </Link>
      </div>
      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">{p.name}</h1>
        </div>
      </div>
      <div className="row mt-1 mb-3 align-items-center">
        <div className="col-auto">
          <div className="text-gray">{p.description}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2">Project Settings</h2>
      <div className="text-muted mb-4">
        Override organization-wide settings for this project. Leave fields blank
        to use the organization default.
      </div>
      <div className="bg-white p-3 border">
        <div className="row">
          <div className="col-sm-3">
            <h4>Experiment Settings</h4>
          </div>
          <div className="col-sm-9">
            <div className="form-inline flex-column align-items-start">
              <Field
                label="Warn when this percent of experiment users are in multiple variations"
                type="number"
                step="any"
                min="0"
                max="1"
                className="ml-2"
                containerClassName="mb-3"
                helpText={<span className="ml-2">from 0 to 1</span>}
                {...form.register("multipleExposureMinPercent", {
                  valueAsNumber: true,
                })}
              />

              <SelectField
                label={
                  <AttributionModelTooltip>
                    Default Attribution Model <FaQuestionCircle />
                  </AttributionModelTooltip>
                }
                className="ml-2"
                containerClassName="mb-3"
                sort={false}
                options={[
                  {
                    label: "Organization default",
                    value: "",
                  },
                  {
                    label: "First Exposure",
                    value: "firstExposure",
                  },
                  {
                    label: "Experiment Duration",
                    value: "experimentDuration",
                  },
                ]}
                value={form.watch("attributionModel")}
                onChange={(v) => form.setValue("attributionModel", v)}
              />

              <SelectField
                label="Statistics Engine"
                className="ml-2"
                containerClassName="mb-3"
                sort={false}
                options={[
                  {
                    label: "Organization default",
                    value: "",
                  },
                  {
                    label: "Bayesian",
                    value: "bayesian",
                  },
                  {
                    label: "Frequentist",
                    value: "frequentist",
                  },
                ]}
                value={form.watch("statsEngine")}
                onChange={(v) => form.setValue("statsEngine", v)}
              />
            </div>
          </div>
        </div>

        <div className="divider border-bottom mb-3 mt-3"></div>

        <div className="row">
          <div className="col-sm-3">
            <h4>Metric Settings</h4>
          </div>
          <div className="col-sm-9"></div>
        </div>
      </div>
    </div>
  );
};

export default ProjectPage;
