import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { ProjectInterface, ProjectSettings } from "back-end/types/project";
import { getScopedSettings } from "shared/settings";
import { Box, Text } from "@radix-ui/themes";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import Button from "@/components/Button";
import RadixButton from "@/components/Radix/Button";
import TempMessage from "@/components/TempMessage";
import ProjectModal from "@/components/Projects/ProjectModal";
import MemberList from "@/components/Settings/Team/MemberList";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/components/Radix/Frame";
import Badge from "@/components/Radix/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import useApi from "@/hooks/useApi";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

function hasChanges(value: ProjectSettings, existing: ProjectSettings) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const ProjectPage: FC = () => {
  const [editChecklistOpen, setEditChecklistOpen] = useState(false);
  const { hasCommercialFeature } = useUser();
  const { organization, refreshOrganization } = useUser();
  const { getProjectById, mutateDefinitions, ready, error } = useDefinitions();

  const { pid } = router.query as { pid: string };
  const p = getProjectById(pid);
  const settings = p?.settings;

  const { settings: parentSettings } = getScopedSettings({
    organization,
  });

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
  );
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<ProjectSettings>({});

  const permissionsUtil = usePermissionsUtil();
  const canEditSettings = permissionsUtil.canUpdateProject(pid);
  // todo: should this also be project scoped?
  const canManageTeam = permissionsUtil.canManageTeam();

  const form = useForm<ProjectSettings>();

  const { data, mutate } = useApi<{
    checklist: ExperimentLaunchChecklistInterface;
  }>(`/experiments/launch-checklist?projectId=${pid}`);

  const checklist = data?.checklist;

  useEffect(() => {
    if (settings) {
      const newVal = { ...form.getValues() };
      Object.keys(settings).forEach((k) => {
        newVal[k] = settings?.[k] || newVal[k];
      });
      form.reset(newVal);
      setOriginalValue(newVal);
    }
  }, [form, settings]);

  const ctaEnabled = hasChanges(form.getValues(), originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
    await apiCall(`/projects/${pid}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        settings: value,
      }),
    });

    // show the user that the settings have saved:
    setSaveMsg(true);
    mutateDefinitions();
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
      {editChecklistOpen && (
        <ExperimentCheckListModal
          close={() => setEditChecklistOpen(false)}
          projectParams={{ projectId: pid, projectName: p.name }}
        />
      )}

      <div className="container pagecontents">
        <div className="mb-2">
          <Link href="/projects">
            <GBCircleArrowLeft className="mr-1" />
            Back to all projects
          </Link>
        </div>
        {p.managedBy?.type ? (
          <div className="mb-2">
            <Badge
              label={`Managed by ${capitalizeFirstLetter(p.managedBy.type)}`}
            />
          </div>
        ) : null}
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
          <div className="text-gray">
            {p.description || <em>add description</em>}
          </div>
          <div className="ml-1">
            <a
              role="button"
              className="link-purple"
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
          />
        </div>

        <h2 className="mt-4 mb-4">Project Settings</h2>
        {/*<div className="text-muted mb-4">*/}
        {/*  Override organization-wide settings for this project. Leave fields*/}
        {/*  blank to use the organization default.*/}
        {/*</div>*/}
        <Frame>
          <div className="row">
            <div className="col-sm-3">
              <h3>Experiment Settings</h3>
            </div>
            <div className="col-sm-9">
              <StatsEngineSelect
                value={form.watch("statsEngine")}
                onChange={(v) => {
                  form.setValue("statsEngine", v || undefined);
                }}
                label="Default Statistics Engine"
                parentSettings={parentSettings}
              />
              <Box mb="6" mt="6">
                <PremiumTooltip
                  commercialFeature="custom-launch-checklist"
                  premiumText="Custom pre-launch checklists are available to Enterprise customers"
                >
                  <Text size="3" className="font-weight-semibold">
                    Experiment Pre-Launch Checklist
                  </Text>
                </PremiumTooltip>
                <p className="pt-2">
                  Configure required steps that need to be completed before an
                  experiment can be launched. By default, experiments use your
                  organization&apos;s default Pre-Launch Checklist. However, you
                  can create a custom checklist for experiments in this project.
                </p>
                <RadixButton
                  variant="soft"
                  className="mr-2"
                  disabled={!hasCommercialFeature("custom-launch-checklist")}
                  onClick={async () => {
                    setEditChecklistOpen(true);
                  }}
                >
                  {checklist?.id ? "Edit" : "Create"} Checklist
                </RadixButton>
                {checklist?.id ? (
                  <DeleteButton
                    displayName="Checklist"
                    useRadix={true}
                    text="Delete Checklist"
                    deleteMessage="Once deleted, all experiments in this project will revert to using your organization's default Pre-Launch Checklist."
                    onClick={async () => {
                      await apiCall(
                        `/experiments/launch-checklist/${checklist.id}`,
                        {
                          method: "DELETE",
                        },
                      );
                      mutate();
                    }}
                  />
                ) : null}
              </Box>
            </div>
          </div>
        </Frame>
      </div>

      <div
        className="bg-main-color position-sticky w-100 py-3"
        style={{ bottom: 0, height: 70 }}
      >
        <div className="container-fluid pagecontents d-flex">
          <div className="flex-grow-1 mr-4">
            {saveMsg && (
              <TempMessage
                className="mb-0 py-2"
                close={() => {
                  setSaveMsg(false);
                }}
              >
                Settings saved
              </TempMessage>
            )}
          </div>
          <div>
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
      </div>
    </>
  );
};

export default ProjectPage;
