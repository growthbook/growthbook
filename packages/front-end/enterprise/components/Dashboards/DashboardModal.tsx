import cronstrue from "cronstrue";
import { useForm } from "react-hook-form";
import React, { useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import { getExperimentRefreshFrequency } from "@/services/env";
import { useUser } from "@/services/UserContext";
import {
  autoUpdateDisabledMessage,
  CreateDashboardArgs,
} from "./DashboardsTab";

const defaultFormInit = {
  title: "",
  editLevel: "private",
  enableAutoUpdates: true,
} as const;

export default function DashboardModal({
  mode,
  initial,
  close,
  submit,
  type = "experiment",
}: {
  mode: "create" | "edit" | "duplicate";
  initial?: CreateDashboardArgs["data"];
  close: () => void;
  submit: (data: CreateDashboardArgs["data"]) => void;
  type?: "general" | "experiment";
}) {
  const defaultRefreshInterval = getExperimentRefreshFrequency();
  const {
    settings: { updateSchedule },
    hasCommercialFeature,
  } = useUser();

  // For general dashboards, auto-updates don't make sense since there's no experiment to update from
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
    editLevel: "organization" | "private";
    enableAutoUpdates: boolean;
  }>({
    defaultValues: initial ?? {
      ...defaultFormInit,
      // For general dashboards, disable auto-updates by default
      enableAutoUpdates: isGeneralDashboard
        ? false
        : defaultFormInit.enableAutoUpdates,
    },
  });

  useEffect(() => {
    form.reset(
      initial || {
        ...defaultFormInit,
        // For general dashboards, disable auto-updates by default
        enableAutoUpdates: isGeneralDashboard
          ? false
          : defaultFormInit.enableAutoUpdates,
      },
    );
  }, [form, initial, isGeneralDashboard]);

  return (
    <Modal
      open={true}
      size="md"
      trackingEventModalType={`${mode}-dashboard`}
      header={
        mode === "edit"
          ? "Edit Dashboard Details"
          : mode === "create"
            ? "Create New Dashboard"
            : "Duplicate Dashboard"
      }
      cta={initial ? "Done" : "Create"}
      submit={() => submit(form.getValues())}
      ctaEnabled={!!form.watch("title")}
      close={close}
      closeCta="Cancel"
    >
      <Flex direction="column" gap="3">
        <Field
          label="Name"
          placeholder="Dashboard name"
          {...form.register("title")}
        />
        {refreshInterval && !isGeneralDashboard && (
          <Checkbox
            label="Auto-update dashboard data"
            description={`An automatic data refresh will occur ${refreshInterval}.`}
            disabled={updateSchedule?.type === "never"}
            disabledMessage={autoUpdateDisabledMessage}
            value={form.watch("enableAutoUpdates")}
            setValue={(checked) => form.setValue("enableAutoUpdates", checked)}
          />
        )}

        {/* //MKTODO: Make this a premium feature? */}
        <Checkbox
          label="Allow organization members to edit"
          description="Anyone with edit access to this Project can edit this dashboard."
          disabled={!hasCommercialFeature("dashboards")}
          value={form.watch("editLevel") === "organization"}
          setValue={(checked) => {
            form.setValue("editLevel", checked ? "organization" : "private");
          }}
        />
      </Flex>
    </Modal>
  );
}
