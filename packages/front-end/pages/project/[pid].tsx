import { BsThreeDotsVertical } from "react-icons/bs";
import { PiDetective } from "react-icons/pi";
import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import NextLink from "next/link";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { ProjectInterface, ProjectSettings } from "shared/types/project";
import { getScopedSettings } from "shared/settings";
import { DEFAULT_CONFIDENCE_LEVEL } from "shared/constants";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import TempMessage from "@/components/TempMessage";
import ProjectModal from "@/components/Projects/ProjectModal";
import ProjectApprovalSettings from "@/components/Projects/ProjectApprovalSettings";
import ProjectAccessSettings from "@/components/Projects/ProjectAccessSettings";
import MemberList from "@/components/Settings/Team/MemberList";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { capitalizeFirstLetter } from "@/services/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import PageHead from "@/components/Layout/PageHead";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import useApi from "@/hooks/useApi";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import Metadata from "@/ui/Metadata";
import ChanceToWinThresholdField from "@/components/GeneralSettings/ExperimentSettings/ChanceToWinThresholdField";
import PValueThresholdField from "@/components/GeneralSettings/ExperimentSettings/PValueThresholdField";
import Callout from "@/ui/Callout";

function emptyStringToUndefined(v: unknown): number | undefined {
  if (v === "" || v === null || v === undefined) return undefined;
  const num = Number(v);
  return Number.isNaN(num) ? undefined : num;
}

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

  const form = useForm<ProjectSettings>({ mode: "onChange" });

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
      if (typeof newVal.confidenceLevel === "number") {
        newVal.confidenceLevel = newVal.confidenceLevel * 100;
      }
      form.reset(newVal);
      setOriginalValue(newVal);
    }
  }, [form, settings]);

  const isValid = form.formState.isValid;
  const ctaEnabled = hasChanges(form.getValues(), originalValue) && isValid;

  const saveSettings = form.handleSubmit(async (value) => {
    const payload: ProjectSettings = { ...value };
    if (typeof payload.confidenceLevel === "number") {
      payload.confidenceLevel = payload.confidenceLevel / 100;
    }
    await apiCall(`/projects/${pid}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        settings: payload,
      }),
    });

    // show the user that the settings have saved:
    setSaveMsg(true);
    mutateDefinitions();
  });

  if (!canEditSettings) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </div>
    );
  }
  if (error) {
    return (
      <div className="container pagecontents">
        <Callout status="error">{error}</Callout>
      </div>
    );
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!p) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Project <code>{pid}</code> does not exist.
        </Callout>
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
      <PageHead
        breadcrumb={[
          { display: "Projects", href: "/projects" },
          { display: p.name },
        ]}
      />
      <Box className="container-fluid contents pagecontents">
        {p.managedBy?.type ? (
          <Box mb="2">
            <Badge
              label={`Managed by ${capitalizeFirstLetter(p.managedBy.type)}`}
            />
          </Box>
        ) : null}
        <Flex align="center" justify="between" width="100%">
          <Flex align="start" direction="column">
            <Flex align="center" gap="3" mb="2">
              <Heading size="xl" as="h1" overflowWrap="anywhere">
                {p.name}
              </Heading>
              {p.restrictAccess ? (
                <Badge
                  color="amber"
                  radius="full"
                  label={
                    <>
                      <PiDetective size={14} /> Restricted access
                    </>
                  }
                />
              ) : null}
            </Flex>
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
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            menuPlacement="end"
            variant="soft"
          >
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setModalOpen(p)}>
                Edit project settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>
        {p.description ? (
          <Box>
            <Text>{p.description}</Text>
          </Box>
        ) : (
          <Box>
            <NextLink
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              Add a description
            </NextLink>
          </Box>
        )}

        <Box mt="4">
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members">Roles & Permissions</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
              <TabsTrigger value="settings">Experiment Settings</TabsTrigger>
            </TabsList>
            <Box pt="4">
              <TabsContent value="settings">
                <Frame>
                  <Flex gap="4">
                    <Box width="220px" flexShrink="0">
                      <Heading as="h4" size="md">
                        Experiment Analysis
                      </Heading>
                    </Box>
                    <Flex align="start" direction="column" flexGrow="1">
                      <Box
                        className="form-group align-items-start"
                        width="100%"
                      >
                        <Heading as="h5" size="sm">
                          Stats Engine Settings
                        </Heading>
                        <Box mb="3">
                          Experiments use your organization settings by default.
                          Leave the fields blank to use the organization
                          default.
                        </Box>
                        <StatsEngineSelect
                          value={form.watch("statsEngine")}
                          onChange={(v) => {
                            form.setValue("statsEngine", v || undefined);
                          }}
                          parentSettings={parentSettings}
                        />

                        <Box mt="3">
                          <Tabs defaultValue="bayesian">
                            <TabsList>
                              <TabsTrigger value="bayesian">
                                Bayesian
                              </TabsTrigger>
                              <TabsTrigger value="frequentist">
                                Frequentist
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="bayesian" forceMount>
                              <Box mt="4">
                                <h4 className="mb-4 text-purple">
                                  Bayesian Settings
                                </h4>
                                <div className="form-group mb-2 mr-2 form-inline">
                                  <ChanceToWinThresholdField
                                    form={form}
                                    name="confidenceLevel"
                                    value={form.watch("confidenceLevel")}
                                    defaultValue={
                                      (parentSettings.confidenceLevel.value ??
                                        DEFAULT_CONFIDENCE_LEVEL) * 100
                                    }
                                    helpTextAppend={
                                      <span className="ml-2">
                                        (
                                        {Math.round(
                                          (parentSettings.confidenceLevel
                                            .value ?? 0.95) * 100,
                                        )}
                                        % is your organization default)
                                      </span>
                                    }
                                    rules={{
                                      setValueAs: emptyStringToUndefined,
                                    }}
                                  />
                                </div>
                              </Box>
                            </TabsContent>
                            <TabsContent value="frequentist" forceMount>
                              <Box mt="4">
                                <h4 className="mb-4 text-purple">
                                  Frequentist Settings
                                </h4>
                                <div className="form-group mb-2 mr-2 form-inline">
                                  <PValueThresholdField
                                    form={form}
                                    name="pValueThreshold"
                                    value={form.watch("pValueThreshold")}
                                    defaultValue={
                                      parentSettings.pValueThreshold.value ??
                                      0.05
                                    }
                                    helpTextAppend={
                                      <span className="ml-2">
                                        (
                                        {parentSettings.pValueThreshold.value ??
                                          0.05}{" "}
                                        is your organization default)
                                      </span>
                                    }
                                    rules={{
                                      setValueAs: emptyStringToUndefined,
                                    }}
                                  />
                                </div>
                              </Box>
                            </TabsContent>
                          </Tabs>
                        </Box>
                      </Box>
                    </Flex>
                  </Flex>
                </Frame>
                <Frame>
                  <Flex gap="4" mb="4">
                    <Box width="220px" flexShrink="0">
                      <Heading as="h4" size="md">
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
                            <Heading as="h5" size="sm">
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
              <TabsContent value="approvals">
                <ProjectApprovalSettings project={pid} projectName={p.name} />
              </TabsContent>
              <TabsContent value="members">
                <ProjectAccessSettings project={p} />
                <MemberList
                  mutate={refreshOrganization}
                  project={pid}
                  // Scoped controls only: this page assigns roles on THIS
                  // project, never the global editor or other projects' roles.
                  canEditRoles={false}
                  canEditProjectRoles={canEditSettings}
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
