import { ReactNode, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FeatureValueType } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import {
  useCustomFields,
  filterCustomFieldsForSectionAndProject,
} from "@/hooks/useCustomFields";
import { useUser } from "@/services/UserContext";
import FeatureKeyField from "./FeatureKeyField";
import { FeatureFormFieldsValues } from "./FeatureFormTypes";
import EnvironmentSelect from "./EnvironmentSelect";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

type Props = {
  initialShowTags?: boolean;
  initialShowDescription?: boolean;
  descriptionAutofocus?: boolean;
  afterDescription?: ReactNode;
  showValueType?: boolean;
  onValueTypeChange: (valueType: FeatureValueType) => void;
  afterValueType?: ReactNode;
  environments: Environment[];
};

export default function FeatureFormFields({
  initialShowTags = false,
  initialShowDescription = false,
  descriptionAutofocus = false,
  afterDescription,
  showValueType = true,
  onValueTypeChange,
  afterValueType,
  environments,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const allCustomFields = useCustomFields();
  const { control, register, setValue } =
    useFormContext<FeatureFormFieldsValues>();
  const tags = useWatch({ control, name: "tags" }) ?? [];
  const description = useWatch({ control, name: "description" }) ?? "";
  const selectedProject = useWatch({ control, name: "project" });
  const customFieldValues = useWatch({ control, name: "customFields" }) ?? {};
  const valueType = useWatch({ control, name: "valueType" });
  const environmentSettings =
    useWatch({ control, name: "environmentSettings" }) ?? {};
  const customFields = hasCommercialFeature("custom-metadata")
    ? filterCustomFieldsForSectionAndProject(
        allCustomFields,
        "feature",
        selectedProject,
      )
    : undefined;
  const [showTags, setShowTags] = useState(initialShowTags);
  const [showDescription, setShowDescription] = useState(
    initialShowDescription,
  );

  return (
    <>
      <FeatureKeyField keyField={register("id")} />

      {showTags ? (
        <TagsField
          value={tags}
          onChange={(nextTags) => setValue("tags", nextTags)}
        />
      ) : (
        <a
          href="#"
          className="badge badge-light badge-pill mr-3 mb-3"
          onClick={(e) => {
            e.preventDefault();
            setShowTags(true);
          }}
        >
          + tags
        </a>
      )}

      {showDescription ? (
        <div className="form-group">
          <label>Description</label>
          <MarkdownInput
            value={description}
            setValue={(nextDescription) =>
              setValue("description", nextDescription)
            }
            autofocus={descriptionAutofocus}
          />
        </div>
      ) : (
        <a
          href="#"
          className="badge badge-light badge-pill mb-3"
          onClick={(e) => {
            e.preventDefault();
            setShowDescription(true);
          }}
        >
          + description
        </a>
      )}

      {afterDescription}

      {customFields && customFields.length > 0 && (
        <div>
          <CustomFieldInput
            customFields={customFields}
            setCustomFields={(fields) => setValue("customFields", fields)}
            currentCustomFields={customFieldValues}
            section={"feature"}
            project={selectedProject}
          />
        </div>
      )}

      {showValueType && (
        <>
          <ValueTypeField value={valueType} onChange={onValueTypeChange} />
          {afterValueType}
        </>
      )}

      <EnvironmentSelect
        environmentSettings={environmentSettings}
        environments={environments}
        project={selectedProject || ""}
        setValue={(env, enabled) => {
          setValue("environmentSettings", {
            ...environmentSettings,
            [env.id]: {
              ...(environmentSettings[env.id] ?? {
                enabled: false,
                rules: [],
              }),
              enabled,
            },
          });
        }}
      />
    </>
  );
}
