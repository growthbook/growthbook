import { FC, useMemo } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { findCollidingUserIdTypeName } from "shared/util";
import MultiSelectField from "@/ui/MultiSelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";

type EditIdentifierTypeProps = {
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onCancel: () => void;
  userIdType: string;
  description?: string;
  attributes?: string[];
  /** Event Forwarder provisions hash-attribute identifier types. Editable — saving hands the record over. */
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
  const existingUserIdTypes = useMemo(
    () => dataSource.settings?.userIdTypes || [],
    [dataSource.settings?.userIdTypes],
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

  // Names are fixed once created, so this only guards new entries. Case-insensitive
  // to match the back-end check: two names differing only in case would collide as
  // one warehouse column.
  const collidingUserIdType = useMemo(() => {
    if (mode !== "add" || !userEnteredUserIdType) {
      return null;
    }
    return findCollidingUserIdTypeName(
      existingUserIdTypes,
      userEnteredUserIdType,
    );
  }, [existingUserIdTypes, mode, userEnteredUserIdType]);

  const saveEnabled = useMemo(() => {
    if (!userEnteredUserIdType) {
      // Disable if empty
      return false;
    }

    // Disable if duplicate
    return (collidingUserIdType ?? null) === null;
  }, [collidingUserIdType, userEnteredUserIdType]);

  const fieldError = collidingUserIdType
    ? `The identifier type ${collidingUserIdType} already exists`
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
        {isEventForwarderManagedType ? (
          <Callout status="info" mb="4">
            Managed by the Event Forwarder. Saving any edit takes ownership and
            stops automatic updates.
          </Callout>
        ) : null}

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
        {hashAttributes && (
          <MultiSelectField
            legacyHeight
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
