import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { ProjectInterface, ProjectSettings } from "back-end/types/project";
import { getScopedSettings } from "shared/settings";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { ExperimentLaunchChecklistInterface } from "back-end/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft } from "@/components/Icons";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import TempMessage from "@/components/TempMessage";
import ProjectModal from "@/components/Projects/ProjectModal";
import MemberList from "@/components/Settings/Team/MemberList";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import useApi from "@/hooks/useApi";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import Metadata from "@/ui/Metadata";

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
      <Box className="container-fluid contents pagecontents mt-2">
        <Box mb="5">
          <Link href="/projects">
            <GBCircleArrowLeft className="mr-1" />
            Back to all projects
          </Link>
        </Box>
        {p.managedBy?.type ? (
          <Box mb="2">
            <Badge
              label={`Managed by ${capitalizeFirstLetter(p.managedBy.type)}`}
            />
          </Box>
        ) : null}
        <Flex align="center" justify="between" width="100%">
          <Flex direction="column" align="start">
            <Heading size="7" as="h1">
              {p.name}
            </Heading>
            <Flex gap="6" mb="4">
              <Metadata
                label="Public ID"
                value={<code>{p.publicId || p.id}</code>}
              />
              <Metadata
                label="ID"
                value={<code className="text-muted">{p.id}</code>}
              />
            </Flex>
          </Flex>
          <MoreMenu useRadix={true}>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              Edit Project Info
            </a>
          </MoreMenu>
        </Flex>
        {p.description ? (
          <Box>
            <Text>{p.description}</Text>
          </Box>
        ) : (
          <Box>
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              Add a description
            </Link>
          </Box>
        )}

        <Box mt="4">
          <Tabs defaultValue="settings">
            <TabsList>
              <TabsTrigger value="settings">Experiment Settings</TabsTrigger>
              <TabsTrigger value="members">Project Members</TabsTrigger>
            </TabsList>
            <Box pt="4">
              <TabsContent value="settings">
                <Frame>
                  <Flex gap="4">
                    <Box width="220px" flexShrink="0">
                      <Heading as="h4" size="4">
                        Experiment Analysis
                      </Heading>
                    </Box>
                    <Flex align="start" direction="column" flexGrow="1">
                      <Box
                        className="form-group align-items-start"
                        width="100%"
                      >
                        <Heading as="h5" size="3">
                          Stats Engine Settings
                        </Heading>
                        <StatsEngineSelect
                          value={form.watch("statsEngine")}
                          onChange={(v) => {
                            form.setValue("statsEngine", v || undefined);
                          }}
                          label="By default, experiments use your organization's default statistics engine, however, you can override this for experiments in this project."
                          parentSettings={parentSettings}
                        />
                      </Box>
                    </Flex>
                  </Flex>
                </Frame>
                <Frame>
                  <Flex gap="4" mb="4">
                    <Box width="220px" flexShrink="0">
                      <Heading as="h4" size="4">
                        Experiment Settings
                      </Heading>
                    </Box>
                    <Flex align="start" direction="column" flexGrow="1">
                      <Box mb="3">
                        <Flex>
                          <PremiumTooltip
                            commercialFeature="custom-launch-checklist"
                            premiumText="Custom pre-launch checklists are available to Enterprise customers"
                          >
                            <Heading as="h5" size="3">
                              Experiment Pre-Launch Checklist
                            </Heading>
                          </PremiumTooltip>
                        </Flex>
                        <p className="pt-2">
                          Configure required steps that need to be completed
                          before an experiment can be launched. By default,
                          experiments use your organization&apos;s default
                          Pre-Launch Checklist. However, you can create a custom
                          checklist for experiments in this project.
                        </p>
                        <RadixButton
                          variant="soft"
                          className="mr-2"
                          disabled={
                            !hasCommercialFeature("custom-launch-checklist")
                          }
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
                    </Flex>
                  </Flex>
                </Frame>
                <div className="w-100 py-3" style={{ bottom: 0, height: 70 }}>
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
              </TabsContent>
              <TabsContent value="members">
                <MemberList
                  mutate={refreshOrganization}
                  project={pid}
                  canEditRoles={canManageTeam}
                  canDeleteMembers={false}
                  canInviteMembers={false}
                />
              </TabsContent>
            </Box>
          </Tabs>
        </Box>
      </Box>
    </>
  );
};

export default ProjectPage;
