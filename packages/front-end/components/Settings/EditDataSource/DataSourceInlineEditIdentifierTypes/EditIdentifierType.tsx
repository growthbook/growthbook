import React, { FC, useMemo } from "react";
import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

type EditIdentifierTypeProps = {
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onCancel: () => void;
  userIdType: string;
  description: string;
  onSave: (name: string, description: string) => Promise<void>;
};

export const EditIdentifierType: FC<EditIdentifierTypeProps> = ({
  dataSource,
  mode,
  userIdType,
  description,
  onSave,
  onCancel,
}) => {
  const existingIds = (dataSource.settings?.userIdTypes || []).map(
    (item) => item.userIdType
  );

  const form = useForm({
    defaultValues: {
      userIdType: userIdType,
      description: description,
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value.userIdType, value.description);

    form.reset({
      userIdType: "",
      description: "",
    });
  });

  const userEnteredUserIdType = form.watch("userIdType");

  const isDuplicate = useMemo(() => {
    return mode === "add" && existingIds.includes(userEnteredUserIdType);
  }, [existingIds, mode, userEnteredUserIdType]);

  const saveEnabled = useMemo(() => {
    if (!userEnteredUserIdType) {
      // Disable if empty
      return false;
    }

    // Disable if duplicate
    return !isDuplicate;
  }, [isDuplicate, userEnteredUserIdType]);

  const fieldError = isDuplicate
    ? `The user identifier ${userEnteredUserIdType} already exists`
    : "";

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={`${mode === "edit" ? "Edit" : "Add"} Identifier Type`}
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#id-modal-identifier-type"
    >
      <>
        <h4 id="id-modal-identifier-type">Identifier Type</h4>
        <div>
          Define all the different units you use to split traffic in an
          experiment. Some examples: user_id, device_id, ip_address.
        </div>

        <Field
          label="Identifier Type"
          {...form.register("userIdType")}
          pattern="^[a-z_]+$"
          title="Only lowercase letters and underscores allowed"
          readOnly={mode === "edit"}
          required
          error={fieldError}
          helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
        />
        <Field
          label="Description (optional)"
          {...form.register("description")}
          minRows={1}
          maxRows={5}
          textarea
        />
      </>
    </Modal>
  );
};
