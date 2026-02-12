import cronstrue from "cronstrue";
import { useForm } from "react-hook-form";
import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardEditLevel,
  DashboardShareLevel,
  DashboardUpdateSchedule,
} from "shared/enterprise";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import { getExperimentRefreshFrequency } from "@/services/env";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioGroup from "@/ui/RadioGroup";
import SelectOwner from "@/components/Owner/SelectOwner";
import {
  autoUpdateDisabledMessage,
  CreateDashboardArgs,
} from "./DashboardsTab";

const defaultUpdateSchedules = {
  stale: {
    type: "stale",
    hours: 6,
  },
  cron: {
    type: "cron",
    cron: "0 0 */2 * *",
  },
} as const;

const defaultFormInit = {
  title: "",
  editLevel: "private",
  shareLevel: "private",
  projects: [],
  userId: "",
} as const;

export default function DashboardModal({
  mode,
  initial,
  dashboardFirstSave,
  close,
  submit,
  type = "experiment",
}: {
  mode: "create" | "edit" | "duplicate";
  initial?: CreateDashboardArgs["data"];
  dashboardFirstSave?: boolean;
  close: () => void;
  submit: (data: CreateDashboardArgs["data"]) => void;
  type?: "general" | "experiment";
}) {
  const [cronString, setCronString] = useState("");
  const [cronError, setCronError] = useState(false);
  const defaultRefreshInterval = getExperimentRefreshFrequency();
  const {
    settings: { updateSchedule },
    hasCommercialFeature,
    userId,
    permissionsUtil,
  } = useUser();

  const { projects } = useDefinitions();
  const isAdmin = permissionsUtil.canManageOrgSettings();
  const isOwner = userId === initial?.userId;
  const canManageSharingAndEditLevels = isOwner || isAdmin;

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  const isGeneralDashboard = type === "general";

  const refreshInterval = useMemo(() => {
    if (!updateSchedule) return `every ${defaultRefreshInterval} hours`;
    if (updateSchedule.type === "never") return;
    if (updateSchedule.type === "stale")
      return updateSchedule.hours
        ? `every ${updateSchedule.hours} hours`
        : undefined;
    if (updateSchedule.cron) {
      const cronString = cronstrue.toString(updateSchedule.cron, {
        verbose: false,
      });
      return cronString.charAt(0).toLowerCase() + cronString.slice(1);
    }
  }, [updateSchedule, defaultRefreshInterval]);

  const form = useForm<{
    title: string;
    editLevel: DashboardEditLevel;
    shareLevel: DashboardShareLevel;
    enableAutoUpdates: boolean;
    updateSchedule?: DashboardUpdateSchedule;
    projects: string[];
    userId: string;
  }>({
    defaultValues: initial ?? {
      ...defaultFormInit,
      projects: [...defaultFormInit.projects],
      shareLevel: !isGeneralDashboard
        ? "published"
        : defaultFormInit.shareLevel,
      updateSchedule: undefined,
    },
  });

  useEffect(() => {
    form.reset(
      initial || {
        ...defaultFormInit,
        projects: [...defaultFormInit.projects],
        shareLevel: !isGeneralDashboard
          ? "published"
          : defaultFormInit.shareLevel,
        enableAutoUpdates: !isGeneralDashboard,
        updateSchedule: undefined,
      },
    );
  }, [form, initial, isGeneralDashboard]);

  function updateCronString(cron?: string) {
    if (!cron) {
      setCronString("");
      return;
    }
    setCronString(
      `${cronstrue.toString(cron, {
        throwExceptionOnParseError: true,
        verbose: true,
      })} (UTC time)`,
    );
  }

  const currentUpdateSchedule = form.watch("updateSchedule");
  useEffect(() => {
    setCronError(false);
    if (currentUpdateSchedule?.type !== "cron") return;
    try {
      updateCronString(currentUpdateSchedule.cron);
    } catch {
      setCronError(true);
    }
  }, [currentUpdateSchedule]);

  const hasGeneralDashboardSharing = hasCommercialFeature(
    "share-product-analytics-dashboards",
  );

  const renderViewAccessSelector = ({
    disabled,
    helpText,
  }: {
    disabled?: boolean;
    helpText?: string;
  }) => (
    <SelectField
      label="View access"
      disabled={disabled}
      helpText={helpText}
      options={[
        { label: "Organization members", value: "published" },
        {
          label: form.watch("userId") === userId ? "Only me" : "Owner only",
          value: "private",
        },
        // { label: "Anyone with the link", value: "public" }, //TODO: Need to build this logic
      ]}
      value={form.watch("shareLevel")}
      onChange={(value) => {
        form.setValue("shareLevel", value as DashboardShareLevel);
        if (value === "private") form.setValue("editLevel", "private");
      }}
    />
  );

  const renderEditAccessSelector = ({
    disabled,
    helpText,
  }: {
    disabled?: boolean;
    helpText?: string;
  }) => (
    <SelectField
      label="Edit access"
      disabled={disabled || form.watch("shareLevel") === "private"}
      helpText={helpText}
      options={[
        {
          label: "Any organization members with editing permission",
          value: "published",
        },
        {
          label: form.watch("userId") === userId ? "Only me" : "Owner only",
          value: "private",
        },
      ]}
      value={form.watch("editLevel")}
      onChange={(value) =>
        form.setValue("editLevel", value as DashboardEditLevel)
      }
    />
  );

  return (
    <Modal
      open={true}
      size="md"
      trackingEventModalType={`${mode}-dashboard`}
      header={
        dashboardFirstSave
          ? "Save Dashboard"
          : mode === "edit"
            ? "Edit Dashboard Settings"
            : mode === "create"
              ? "Create New Dashboard"
              : "Duplicate Dashboard"
      }
      cta={dashboardFirstSave ? "Save" : initial ? "Done" : "Create"}
      submit={() => submit(form.getValues())}
      ctaEnabled={!!form.watch("title") && !cronError}
      close={close}
      closeCta="Cancel"
    >
      <Flex direction="column" gap="3">
        <Field
          label="Name"
          placeholder="Dashboard name"
          {...form.register("title")}
        />
        {mode === "edit" ? (
          <SelectOwner
            disabled={!canManageSharingAndEditLevels}
            resourceType="dashboard"
            value={form.watch("userId")}
            onChange={(v) => form.setValue("userId", v)}
          />
        ) : null}
        {isGeneralDashboard ? (
          <>
            <MultiSelectField
              label="Projects"
              placeholder="All projects"
              options={projectsOptions}
              value={form.watch("projects")}
              onChange={(value) => form.setValue("projects", value)}
            />
            {/* Refresh with its own interval for product analytics dashboards */}
            <Checkbox
              label="Auto-update dashboard data"
              value={form.watch("enableAutoUpdates")}
              setValue={(checked) => {
                form.setValue("enableAutoUpdates", checked);
                form.setValue(
                  "updateSchedule",
                  checked ? defaultUpdateSchedules["stale"] : undefined,
                );
              }}
            />
            {form.watch("enableAutoUpdates") && (
              <Box width="100%">
                <Box className="appbox p-3">
                  <RadioGroup
                    options={[
                      {
                        label: "Refresh results after a specified duration",
                        value: "stale",
                        description: (
                          <Field
                            label="Refresh when"
                            append="hours old"
                            type="number"
                            style={{ width: "180px" }}
                            step={1}
                            min={1}
                            max={168}
                            disabled={currentUpdateSchedule?.type !== "stale"}
                            value={
                              currentUpdateSchedule?.type === "stale"
                                ? currentUpdateSchedule.hours
                                : defaultUpdateSchedules.stale.hours
                            }
                            onChange={(e) => {
                              let hours = 6;
                              try {
                                hours = parseInt(e.target.value);
                              } catch {
                                // pass
                              }
                              form.setValue("updateSchedule.hours", hours);
                            }}
                          />
                        ),
                      },
                      {
                        label: "Cron Schedule",
                        value: "cron",
                        description: (
                          <>
                            <Text mb="2" as="p">
                              Enter cron string to specify frequency. Minimum
                              once an hour.
                            </Text>
                            <Field
                              disabled={currentUpdateSchedule?.type !== "cron"}
                              value={
                                currentUpdateSchedule?.type === "cron"
                                  ? currentUpdateSchedule.cron
                                  : defaultUpdateSchedules.cron.cron
                              }
                              onChange={(e) => {
                                form.setValue("updateSchedule", {
                                  type: "cron",
                                  cron: e.target.value,
                                });
                              }}
                              helpText={
                                cronError ? (
                                  "Invalid cron string"
                                ) : cronString ? (
                                  <span className="ml-2">{cronString}</span>
                                ) : (
                                  "Example: 0 0 */2 * * *"
                                )
                              }
                            />
                          </>
                        ),
                      },
                    ]}
                    gap="2"
                    descriptionSize="2"
                    value={currentUpdateSchedule?.type ?? "stale"}
                    setValue={(v) => {
                      form.setValue(
                        "updateSchedule",
                        defaultUpdateSchedules[v],
                      );
                    }}
                  />
                </Box>
              </Box>
            )}
          </>
        ) : (
          <>
            {/* Refresh based on experiment refresh schedule */}
            {refreshInterval && (
              <Checkbox
                label="Auto-update dashboard data"
                description={`An automatic data refresh will occur ${refreshInterval}.`}
                disabled={updateSchedule?.type === "never"}
                disabledMessage={autoUpdateDisabledMessage}
                value={form.watch("enableAutoUpdates")}
                setValue={(checked) => {
                  form.setValue("enableAutoUpdates", checked);
                }}
              />
            )}
          </>
        )}
        {mode === "create" || mode === "duplicate" || dashboardFirstSave ? (
          <>
            {renderViewAccessSelector({
              disabled: isGeneralDashboard && !hasGeneralDashboardSharing,
              helpText:
                isGeneralDashboard && !hasGeneralDashboardSharing
                  ? "Your organization's plan does not support sharing dashboards"
                  : undefined,
            })}
            {renderEditAccessSelector({
              disabled: isGeneralDashboard && !hasGeneralDashboardSharing,
              helpText:
                isGeneralDashboard && !hasGeneralDashboardSharing
                  ? "Your organization's plan does not support sharing dashboards"
                  : undefined,
            })}
          </>
        ) : mode === "edit" ? (
          // Editing a dashboard: hide sharing for general dashboards or if the user doesn't have permissions
          <>
            {!isGeneralDashboard && canManageSharingAndEditLevels && (
              <>
                {renderViewAccessSelector({})}
                {renderEditAccessSelector({})}
              </>
            )}
          </>
        ) : null}
      </Flex>
    </Modal>
  );
}
