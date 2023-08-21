import { FC } from "react";
import { StylesConfig } from "react-select";
import { ProjectInterface } from "back-end/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import MultiSelectField from "../Forms/MultiSelectField";

export interface ColorOption {
  readonly value: string;
  readonly label: string;
  readonly color: string;
  readonly desc: string;
  readonly isFixed?: boolean;
  readonly isDisabled?: boolean;
}

const ProjectsInput: FC<{
  onChange: (tags: string[]) => void;
  value: string[];
  autoFocus?: boolean;
  closeMenuOnSelect?: boolean;
  projectOptions?: ProjectInterface[];
  prompt?: string;
  creatable?: boolean;
}> = ({
  onChange,
  value,
  autoFocus = true,
  closeMenuOnSelect = false,
  projectOptions,
  prompt = "Tags...",
  creatable = true,
}) => {
  const { projects } = useDefinitions();

  const permissions = usePermissions();
  if (!projectOptions) {
    console.log("setting default");
    projectOptions = projects;
  }

  if (!permissions.organizationSettings) {
    creatable = false;
  }
  projectOptions = [...projectOptions];

  const projectStyles: StylesConfig<ColorOption, true> = {
    option: (styles, { isDisabled, isFocused, isSelected }) => {
      const displayColor = "#029dd1";
      return {
        ...styles,
        backgroundColor: isDisabled
          ? undefined
          : isSelected
          ? displayColor + "20"
          : isFocused
          ? displayColor + "25"
          : displayColor + "00",
        color: isDisabled ? "#ccc" : "#000",
        cursor: isDisabled ? "not-allowed" : "default",
        alignItems: "center",
        display: "flex",
        ":active": {
          ...styles[":active"],
          backgroundColor: displayColor + "90",
        },
      };
    },
    multiValue: (styles, { data }) => {
      return {
        ...styles,
        borderRadius: 4,
        backgroundColor: data.color,
        color: "#ffffff",
      };
    },
    multiValueLabel: (styles) => ({
      ...styles,
      color: "#ffffff",
    }),
    multiValueRemove: (styles, { data }) => ({
      ...styles,
      color: "#ffffff",
      ":hover": {
        backgroundColor: data.color + "cc",
      },
    }),
  };

  return (
    <MultiSelectField
      options={
        projectOptions.map((p) => {
          return {
            value: p.id,
            label: p.name,
            color: "var(--form-multivalue-text-color)",
            tooltip: p.description,
          };
        }) ?? []
      }
      value={value}
      onChange={(value: string[]) => {
        onChange(value.filter((p) => p.length > 0));
      }}
      closeMenuOnSelect={closeMenuOnSelect}
      autoFocus={autoFocus}
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'StylesConfig<ColorOption, true, GroupBase<Co... Remove this comment to see the full error message
      customStyles={projectStyles}
      placeholder={prompt}
      creatable={creatable}
    />
  );
};

export default ProjectsInput;
