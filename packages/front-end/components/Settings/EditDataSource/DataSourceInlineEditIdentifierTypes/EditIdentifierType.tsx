import { FC, useMemo } from "react";
import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Field from "@/components/Forms/Field";

type EditIdentifierTypeProps = {
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onCancel: () => void;
  userIdType: string;
  description?: string;
  attributes?: string[];
  onSave: (
    name: string,
    description: string,
    attributes: string[],
  ) => Promise<void>;
};

export const EditIdentifierType: FC<EditIdentifierTypeProps> = ({
  dataSource,
  mode,
  userIdType,
  description,
  attributes,
  onSave,
  onCancel,
}) => {
  const existingIds = (dataSource.settings?.userIdTypes || []).map(
    (item) => item.userIdType,
  );

  const { attributeSchema } = useOrgSettings();

  const hashAttributes = useMemo(() => {
    return attributeSchema
      ?.filter((attribute) => {
        const isInProjects =
          dataSource.projects?.length && attribute.projects?.length
            ? attribute.projects.some((project) =>
                dataSource.projects?.includes(project),
              )
            : true;
        const isHashAttribute = attribute.hashAttribute;
        return isInProjects && isHashAttribute;
      })
      .map((attribute) => attribute.property);
  }, [attributeSchema, dataSource.projects]);

  const form = useForm<{
    idType: string;
    description: string;
    attributes: string[];
  }>({
    defaultValues: {
      idType: userIdType,
      description: description,
      attributes: attributes || [],
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value.idType, value.description, value.attributes);

    form.reset({
      idType: "",
      description: "",
      attributes: [],
    });
  });

  const userEnteredUserIdType = form.watch("idType");

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
    <DialogLayout
      trackingEventModalType=""
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="md"
      header={`${mode === "edit" ? "Edit" : "Add"} Identifier Type`}
      subheader="Define all the different units you use to split traffic in an
            experiment"
      ctaEnabled={saveEnabled}
    >
      <>
        <Field
          label="Identifier Type"
          labelClassName="font-weight-bold"
          {...form.register("idType")}
          pattern="^[a-z_]+$"
          readOnly={mode === "edit"}
          required
          error={fieldError}
          helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
        />
        <Field
          label="Description (optional)"
          labelClassName="font-weight-bold"
          {...form.register("description")}
          minRows={1}
          maxRows={5}
          textarea
        />
        {hashAttributes && (
          <MultiSelectField
            label="Hash Attributes"
            labelClassName="font-weight-bold"
            value={form.watch("attributes")}
            helpText="Select the hash attributes that map to this identifier type."
            onChange={(value) => {
              form.setValue("attributes", value);
            }}
            options={hashAttributes.map((attribute) => ({
              value: attribute,
              label: attribute,
            }))}
          />
        )}
      </>
    </DialogLayout>
  );
};
