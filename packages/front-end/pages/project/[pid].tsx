import { BsThreeDotsVertical } from "react-icons/bs";
import { PiDetective } from "react-icons/pi";
import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { ProjectInterface, ProjectSettings } from "shared/types/project";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_EXPERIMENT_IMPLEMENTATION,
  DEFAULT_P_VALUE_THRESHOLD,
} from "shared/constants";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import RadixButton from "@/ui/Button";
import TempMessage from "@/components/TempMessage";
import ProjectModal from "@/components/Projects/ProjectModal";
import ProjectApprovalSettings from "@/components/Projects/ProjectApprovalSettings";
import ProjectAccessSettings from "@/components/Projects/ProjectAccessSettings";
import DeleteProjectModal from "@/components/Projects/DeleteProjectModal";
import ProjectTeams from "@/components/Projects/ProjectTeams";
import MemberList from "@/components/Settings/Team/MemberList";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import ImplementationTypeSelect from "@/components/Experiment/ImplementationTypeSelect";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { capitalizeFirstLetter } from "@/services/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import PageHead from "@/components/Layout/PageHead";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import useApi from "@/hooks/useApi";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import Metadata from "@/ui/Metadata";
import CopyableCode from "@/components/Settings/CopyableCode";
import {
  getConfidenceLevelHighlight,
  warningHighlight,
} from "@/components/GeneralSettings/ExperimentSettings/ChanceToWinThresholdField";
import { getPValueThresholdHighlight } from "@/components/GeneralSettings/ExperimentSettings/PValueThresholdField";
import {
  SettingsField,
  SettingsGroup,
  SettingsSubheading,
} from "@/components/GeneralSettings/SettingsGroup";
import Field from "@/components/Forms/Field";
import HelperText from "@/ui/HelperText";
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [originalValue, setOriginalValue] = useState<ProjectSettings>({});

  const permissionsUtil = usePermissionsUtil();
  const canEditSettings = permissionsUtil.canUpdateProject(pid);
  // Externally managed projects are deleted from their manager, not here.
  const canDelete =
    permissionsUtil.canDeleteProject(pid) && !p?.managedBy?.type;

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

  const confidence = getConfidenceLevelHighlight(form.watch("confidenceLevel"));
  const pValue = getPValueThresholdHighlight(form.watch("pValueThreshold"));
  const orgConfidence = Math.round(
    (parentSettings.confidenceLevel.value ?? DEFAULT_CONFIDENCE_LEVEL) * 100,
  );
  const orgPValue =
    parentSettings.pValueThreshold.value ?? DEFAULT_P_VALUE_THRESHOLD;

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
          Project{" "}
          <Text as="span" size="inherit" mono>
            {pid}
          </Text>{" "}
          does not exist.
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
      {deleteOpen && (
        <DeleteProjectModal
          project={p}
          close={() => setDeleteOpen(false)}
          onDeleted={async () => {
            await mutateDefinitions();
            router.push("/projects");
          }}
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
              <Metadata label="ID" value={<CopyableCode value={p.id} />} />
              {p.publicId && (
                <Metadata
                  label="Public ID (SDK payloads)"
                  value={<CopyableCode value={p.publicId} muted />}
                />
              )}
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
                aria-label="Project actions"
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
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    color="red"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete project
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
          </DropdownMenu>
        </Flex>
        {p.description ? (
          <Box>
            <Text>{p.description}</Text>
          </Box>
        ) : (
          <Box>
            <Link onClick={() => setModalOpen(p)}>Add a description</Link>
          </Box>
        )}

        <Box mt="4">
          <Tabs defaultValue="members" persistInURL>
            <TabsList>
              <TabsTrigger value="members">Roles & Permissions</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
              <TabsTrigger value="settings">Experiment Settings</TabsTrigger>
            </TabsList>
            <Box pt="4">
              <TabsContent value="settings">
                <SettingsGroup
                  id="project-stats-engine"
                  title="Stats Engine"
                  description="Experiments in this Project use the organization's settings. Leave a field blank to keep doing so."
                >
                  <SettingsField
                    htmlFor="project-statsEngine"
                    label="Stats engine"
                  >
                    <Box width="240px" maxWidth="100%">
                      <StatsEngineSelect
                        label={null}
                        className=""
                        containerClassName="mb-0"
                        value={form.watch("statsEngine")}
                        onChange={(v) => {
                          form.setValue("statsEngine", v || undefined);
                        }}
                        parentSettings={parentSettings}
                      />
                    </Box>
                  </SettingsField>
                  <SettingsSubheading>Bayesian</SettingsSubheading>
                  <SettingsField
                    htmlFor="project-confidenceLevel"
                    label="Chance to win threshold"
                    help={`A variation is a winner above this probability. Blank uses the organization's ${orgConfidence}%.`}
                  >
                    <Box width="150px">
                      <Field
                        id="project-confidenceLevel"
                        size="md"
                        type="number"
                        step="any"
                        min="70"
                        max="99.9999"
                        append="%"
                        containerClassName="mb-0"
                        style={warningHighlight(confidence.highlightColor)}
                        placeholder={String(orgConfidence)}
                        {...form.register("confidenceLevel", {
                          setValueAs: emptyStringToUndefined,
                          min: 70,
                          max: 99.9999,
                        })}
                      />
                    </Box>
                    {confidence.warningMsg && (
                      <HelperText status="warning" size="sm" mt="1">
                        {confidence.warningMsg}
                      </HelperText>
                    )}
                  </SettingsField>
                  <SettingsSubheading>Frequentist</SettingsSubheading>
                  <SettingsField
                    htmlFor="project-pValueThreshold"
                    label="P-value threshold"
                    help={`A result is significant below this p-value. Blank uses the organization's ${orgPValue}.`}
                  >
                    <Box width="150px">
                      <Field
                        id="project-pValueThreshold"
                        size="md"
                        type="number"
                        step="any"
                        min="0"
                        max="0.5"
                        containerClassName="mb-0"
                        style={warningHighlight(pValue.highlightColor)}
                        placeholder={String(orgPValue)}
                        {...form.register("pValueThreshold", {
                          setValueAs: emptyStringToUndefined,
                          validate: (v) =>
                            v === undefined || (v > 0 && v <= 0.5),
                        })}
                      />
                    </Box>
                    {pValue.warningMsg && (
                      <HelperText status="warning" size="sm" mt="1">
                        {pValue.warningMsg}
                      </HelperText>
                    )}
                  </SettingsField>
                </SettingsGroup>
                <SettingsGroup
                  id="project-new-experiments"
                  title="Defaults for New Experiments"
                  description="Applied when someone creates an experiment in this Project."
                >
                  <SettingsField
                    label="Implementation"
                    help="Preselected when creating an experiment."
                  >
                    <Box width="320px" maxWidth="100%">
                      <ImplementationTypeSelect
                        label={null}
                        value={form.watch("defaultExperimentImplementation")}
                        setValue={(value) =>
                          form.setValue(
                            "defaultExperimentImplementation",
                            value,
                          )
                        }
                        inherited={
                          parentSettings.defaultExperimentImplementation
                            .value ?? DEFAULT_EXPERIMENT_IMPLEMENTATION
                        }
                      />
                    </Box>
                  </SettingsField>
                </SettingsGroup>
                <SettingsGroup
                  id="project-launch"
                  title="Launch Requirements"
                  description="What experimenters must do before an experiment in this Project can launch."
                >
                  <SettingsField
                    label={
                      <PremiumTooltip
                        commercialFeature="custom-launch-checklist"
                        premiumText="Custom pre-launch checklists are available to Enterprise customers"
                      >
                        Pre-launch checklist
                      </PremiumTooltip>
                    }
                    help="Experiments use the organization's checklist unless this Project has its own."
                  >
                    <Flex align="center" gap="2">
                      <RadixButton
                        variant="soft"
                        disabled={
                          !hasCommercialFeature("custom-launch-checklist")
                        }
                        onClick={async () => {
                          setEditChecklistOpen(true);
                        }}
                      >
                        {checklist?.id ? "Edit" : "Create"} checklist
                      </RadixButton>
                      {checklist?.id ? (
                        <DeleteButton
                          displayName="Checklist"
                          text="Delete checklist"
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
                    </Flex>
                  </SettingsField>
                </SettingsGroup>
                <Flex
                  justify="end"
                  align="center"
                  gap="4"
                  // Clears the help launcher, which publishes its footprint (see InAppHelp).
                  style={{
                    paddingRight: "var(--help-launcher-clearance, 0px)",
                  }}
                >
                  {saveError && <Callout status="error">{saveError}</Callout>}
                  {saveMsg && (
                    <TempMessage
                      close={() => {
                        setSaveMsg(false);
                      }}
                    >
                      Settings saved
                    </TempMessage>
                  )}
                  <RadixButton
                    size="lg"
                    disabled={!ctaEnabled}
                    onClick={saveSettings}
                    setError={setSaveError}
                  >
                    Save
                  </RadixButton>
                </Flex>
              </TabsContent>
              <TabsContent value="approvals">
                <ProjectApprovalSettings project={pid} projectName={p.name} />
              </TabsContent>
              <TabsContent value="members">
                <ProjectAccessSettings project={p} />
                <ProjectTeams project={pid} />
                <MemberList
                  mutate={refreshOrganization}
                  project={pid}
                  // Scoped controls only — never the global role editor here
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
