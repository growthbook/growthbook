import { FC } from "react";
import { StylesConfig } from "react-select";
import { TagInterface } from "back-end/types/tag";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import MultiSelectField from "../Forms/MultiSelectField";
import { isLight } from "./Tag";

export interface ColorOption {
  readonly value: string;
  readonly label: string;
  readonly color: string;
  readonly desc: string;
  readonly isFixed?: boolean;
  readonly isDisabled?: boolean;
}

const TagsInput: FC<{
  onChange: (tags: string[]) => void;
  value: string[];
  autoFocus?: boolean;
  closeMenuOnSelect?: boolean;
  tagOptions?: TagInterface[];
  prompt?: string;
  creatable?: boolean;
}> = ({
  onChange,
  value,
  autoFocus = true,
  closeMenuOnSelect = false,
  tagOptions,
  prompt = "Tags...",
  creatable = true,
}) => {
  const { tags, getTagById } = useDefinitions();
  const permissions = usePermissions();
  if (!tagOptions) tagOptions = tags;

  if (!permissions.manageTags) {
    creatable = false;
  }

  const tagSet = new Set(tagOptions.map((t) => t.id));
  tagOptions = [...tagOptions];
  value.forEach((value) => {
    if (!tagSet.has(value)) {
      tagOptions.push({
        id: value,
        description: "",
        color: getTagById(value)?.color || "#029dd1",
      });
    }
  });

  const tagStyles: StylesConfig<ColorOption, true> = {
    option: (styles, { data, isDisabled, isFocused, isSelected }) => {
      const displayColor = data.color ?? "#029dd1";
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
        // add a colored dot:
        ":before": {
          backgroundColor: data.color,
          borderRadius: 10,
          content: '" "',
          display: "block",
          marginRight: 8,
          height: 10,
          width: 10,
        },
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
        color: isLight(data.color) ? "#000000" : "#ffffff",
      };
    },
    multiValueLabel: (styles, { data }) => ({
      ...styles,
      color: isLight(data.color) ? "#000000" : "#ffffff",
    }),
    multiValueRemove: (styles, { data }) => ({
      ...styles,
      color: isLight(data.color) ? "#000000" : "#ffffff",
      ":hover": {
        backgroundColor: data.color + "cc",
      },
    }),
  };

  return (
    <MultiSelectField
      options={
        tagOptions.map((t) => {
          return {
            value: t.id,
            label: t.id,
            color: t.color || "var(--form-multivalue-text-color)",
            tooltip: t.description,
          };
        }) ?? []
      }
      value={value}
      onChange={(value: string[]) => {
        onChange(value.filter((t) => t.length > 0));
      }}
      closeMenuOnSelect={closeMenuOnSelect}
      autoFocus={autoFocus}
      customStyles={tagStyles}
      placeholder={prompt}
      creatable={creatable}
    />
  );
};

export default TagsInput;
