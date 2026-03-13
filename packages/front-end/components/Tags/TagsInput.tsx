import { FC } from "react";
import { StylesConfig } from "react-select";
import { TagInterface } from "shared/types/tag";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { findClosestRadixColor, TAG_COLORS_MAP } from "@/services/tags";
import { RadixColor } from "@/ui/HelperText";

export interface ColorOption {
  readonly value: string;
  readonly label: string;
  readonly color: string;
  readonly desc: string;
  readonly isFixed?: boolean;
  readonly isDisabled?: boolean;
}

const DEFAULT_TAG_COLOR = TAG_COLORS_MAP["blue"];

const TagsInput: FC<{
  onChange: (tags: string[]) => void;
  value: string[];
  autoFocus?: boolean;
  closeMenuOnSelect?: boolean;
  tagOptions?: TagInterface[];
  prompt?: string;
  creatable?: boolean;
  customClassName?: string;
}> = ({
  onChange,
  value,
  autoFocus = true,
  closeMenuOnSelect = false,
  tagOptions,
  prompt = "Tags...",
  creatable = true,
  customClassName,
}) => {
  const { tags, getTagById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  if (!tagOptions) tagOptions = tags;

  if (!permissionsUtil.canCreateAndUpdateTag()) {
    creatable = false;
  }

  const tagSet = new Set(tagOptions.map((t) => t.id));
  tagOptions = [...tagOptions];
  value.forEach((value) => {
    if (!tagSet.has(value)) {
      const tag = getTagById(value);
      tagOptions?.push({
        id: value,
        label: tag?.label || value,
        description: tag?.description || "",
        color: tag?.color || DEFAULT_TAG_COLOR,
      });
    }
  });

  const tagStyles: StylesConfig<ColorOption, true> = {
    option: (styles, { data, isDisabled }) => {
      const displayColor = data.color ?? DEFAULT_TAG_COLOR;
      return {
        ...styles,
        color: isDisabled ? "#ccc" : "#000",
        cursor: isDisabled ? "not-allowed" : "default",
        alignItems: "center",
        display: "flex",
        // add a colored dot:
        ":before": {
          backgroundColor: data.color as RadixColor,
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
    control: (styles, { isFocused }) => {
      return {
        ...styles,
        boxShadow: `0px 0px 0px 1px ${
          isFocused ? "var(--violet-8)" : undefined
        }`,
      };
    },
    multiValue: (styles, { data }) => {
      const color = findClosestRadixColor(data.color) || "#029dd1";
      return {
        ...styles,
        borderRadius: 4,
        backgroundColor: `var(--${color}-a3)`,
      };
    },
    multiValueLabel: (styles, { data }) => {
      const color = findClosestRadixColor(data.color) || "#029dd1";
      return {
        ...styles,
        color: `var(--${color}-11)`,
      };
    },
    multiValueRemove: (styles, { data }) => {
      return {
        ...styles,
        color: data.color as RadixColor,
        ":hover": {
          backgroundColor: data.color + "cc",
          color: "#ffffff",
        },
      };
    },
  };

  return (
    <MultiSelectField
      options={
        tagOptions.map((t) => {
          // Converts Radix color to hex color to make it compatible with MultiSelectField
          const hexColor = TAG_COLORS_MAP[t.color] ?? DEFAULT_TAG_COLOR;
          return {
            value: t.id,
            label: t.label,
            color: hexColor || "var(--form-multivalue-text-color)",
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
      customClassName={customClassName}
    />
  );
};

export default TagsInput;
