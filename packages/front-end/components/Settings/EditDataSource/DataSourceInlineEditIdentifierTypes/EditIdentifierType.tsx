import { FC, useMemo } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import MultiSelectField from "@/ui/MultiSelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";

type EditIdentifierTypeProps = {
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onCancel: () => void;
  userIdType: string;
  description?: string;
  attributes?: string[];
  /** Event forwarder provisions hash-attribute identifier types; only description is editable. */
  isEventForwarderManagedType?: boolean;
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
  isEventForwarderManagedType = false,
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
    <ModalStandard
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
          size="legacy"
          label="Identifier Type"
          {...form.register("idType")}
          pattern="^[a-z_]+$"
          readOnly={mode === "edit" || isEventForwarderManagedType}
          required
          error={fieldError}
          helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
        />
        <Field
          size="legacy"
          label="Description (optional)"
          maxLength={MAX_DESCRIPTION_LENGTH}
          {...form.register("description")}
          minRows={1}
          maxRows={5}
          textarea
        />
        {hashAttributes && !isEventForwarderManagedType && (
          <MultiSelectField
            size="legacy"
            label="Hash Attributes"
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
    </ModalStandard>
  );
};
