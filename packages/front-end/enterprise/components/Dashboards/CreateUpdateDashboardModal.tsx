import { useForm } from "react-hook-form";
import React, { useEffect } from "react";
import { Flex } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Checkbox from "@/components/Radix/Checkbox";
import {
  autoUpdateDisabledMessage,
  CreateDashboardArgs,
} from "./DashboardsTab";

const defaultFormInit = {
  title: "",
  editLevel: "private",
  enableAutoUpdates: true,
} as const;

export default function CreateUpdateDashboardModal({
  disableAutoUpdate,
  initial,
  close,
  submit,
}: {
  disableAutoUpdate?: boolean;
  initial?: CreateDashboardArgs["data"];
  close: () => void;
  submit: (data: CreateDashboardArgs["data"]) => void;
}) {
  const form = useForm<{
    title: string;
    editLevel: "organization" | "private";
    enableAutoUpdates: boolean;
  }>({
    defaultValues: initial ?? defaultFormInit,
  });

  useEffect(() => {
    form.reset(initial || defaultFormInit);
  }, [form, initial]);

  return (
    <Modal
      open={true}
      size="lg"
      trackingEventModalType="create-dashboard"
      header={initial ? "Edit Dashboard Details" : "Create New Dashboard"}
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
        <Checkbox
          label="Auto-update block content"
          // TODO: pull X
          description="An automatic data refresh will occur every X minutes."
          disabled={disableAutoUpdate}
          disabledMessage={autoUpdateDisabledMessage}
          value={form.watch("enableAutoUpdates")}
          setValue={(checked) => form.setValue("enableAutoUpdates", checked)}
        />

        <Checkbox
          label="Allow organization members to edit"
          description="Anyone with edit access to this Project can edit this dashboard."
          value={form.watch("editLevel") === "organization"}
          setValue={(checked) => {
            form.setValue("editLevel", checked ? "organization" : "private");
          }}
        />
      </Flex>
    </Modal>
  );
}
