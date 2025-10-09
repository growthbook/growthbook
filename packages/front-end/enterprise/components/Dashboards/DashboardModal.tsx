import cronstrue from "cronstrue";
import { useForm } from "react-hook-form";
import React, { useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardEditLevel,
  DashboardShareLevel,
} from "back-end/src/enterprise/validators/dashboard";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import { getExperimentRefreshFrequency } from "@/services/env";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import {
  autoUpdateDisabledMessage,
  CreateDashboardArgs,
} from "./DashboardsTab";

const defaultFormInit = {
  title: "",
  editLevel: "private",
  shareLevel: "private",
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
  }>({
    defaultValues: initial ?? {
      ...defaultFormInit,
      shareLevel: !isGeneralDashboard
        ? "organization"
        : defaultFormInit.shareLevel,
    },
  });

  useEffect(() => {
    form.reset(
      initial || {
        ...defaultFormInit,
        shareLevel: !isGeneralDashboard
          ? "organization"
          : defaultFormInit.shareLevel,
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
        {refreshInterval && (
          <Checkbox
            label="Auto-update dashboard data"
            description={`An automatic data refresh will occur ${refreshInterval}.`}
            disabled={updateSchedule?.type === "never"}
            disabledMessage={autoUpdateDisabledMessage}
            value={form.watch("enableAutoUpdates")}
            setValue={(checked) => form.setValue("enableAutoUpdates", checked)}
          />
        )}
        {isGeneralDashboard ? (
          <SelectField
            label="View access"
            disabled={
              !hasCommercialFeature("share-product-analytics-dashboards")
            }
            options={[
              { label: "Organization members", value: "organization" },
              { label: "Only me", value: "private" },
            ]}
            helpText={
              form.watch("shareLevel") === "organization"
                ? "Other organization members who have read access to the project(s) this dashboard is associated with will be permitted to view this dashboard."
                : "Only you can view this dashboard."
            }
            value={form.watch("shareLevel")}
            onChange={(value) =>
              form.setValue("shareLevel", value as DashboardEditLevel)
            }
          />
        ) : null}
        <SelectField
          label="Edit access"
          disabled={
            !hasCommercialFeature("share-product-analytics-dashboards") ||
            form.watch("shareLevel") === "private"
          }
          options={[
            { label: "Organization members", value: "organization" },
            { label: "Only me", value: "private" },
          ]}
          helpText={
            form.watch("editLevel") === "organization"
              ? "Other organization members who have permission to edit Dashboards will be permitted to edit this dashboard."
              : "Only you can edit this dashboard."
          }
          value={form.watch("editLevel")}
          onChange={(value) =>
            form.setValue("editLevel", value as DashboardEditLevel)
          }
        />
      </Flex>
    </Modal>
  );
}
