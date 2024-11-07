import { FC } from "react";
import { StylesConfig } from "react-select";
import { TagInterface } from "back-end/types/tag";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { TAG_COLORS_MAP, TAG_TEXT_COLORS_MAP } from "@/services/tags";
import { isLight } from "./Tag";

export interface ColorOption {
  readonly value: string;
  readonly label: string;
  readonly color: string;
  readonly desc: string;
  readonly isFixed?: boolean;
  readonly isDisabled?: boolean;
}

const DEFAULT_TAG_COLOR = TAG_COLORS_MAP["blue"];

// Converts Radix color to hex color to make it compatible with MultiSelectField
function getTagColor(color: string): string {
  return TAG_COLORS_MAP[color] ?? DEFAULT_TAG_COLOR;
}

function getTagTextColor(color: string): string {
  const displayColor = TAG_COLORS_MAP[color] ?? DEFAULT_TAG_COLOR;
  const textColor =
    TAG_TEXT_COLORS_MAP[color] ??
    (isLight(displayColor) ? "#000000" : "#ffffff");
  return textColor;
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
  const permissionsUtil = usePermissionsUtil();
  if (!tagOptions) tagOptions = tags;

  if (!permissionsUtil.canCreateAndUpdateTag()) {
    creatable = false;
  }

  const tagSet = new Set(tagOptions.map((t) => t.id));
  tagOptions = [...tagOptions];
  value.forEach((value) => {
    if (!tagSet.has(value)) {
      tagOptions?.push({
        id: value,
        description: "",
        color: getTagById(value)?.color || "#029dd1",
      });
    }
  });

  const tagStyles: StylesConfig<ColorOption, true> = {
    option: (styles, { data, isDisabled, isFocused, isSelected }) => {
      const displayColor = getTagColor(data.color) ?? "#029dd1";
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
          backgroundColor: displayColor,
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
        backgroundColor: getTagColor(data.color),
        color: getTagTextColor(data.color),
      };
    },
    multiValueLabel: (styles, { data }) => ({
      ...styles,
      color: getTagTextColor(data.color),
    }),
    multiValueRemove: (styles, { data }) => ({
      ...styles,
      color: getTagTextColor(data.color),
      ":hover": {
        backgroundColor: getTagColor(data.color) + "cc",
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
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'StylesConfig<ColorOption, true, GroupBase<Co... Remove this comment to see the full error message
      customStyles={tagStyles}
      placeholder={prompt}
      creatable={creatable}
    />
  );
};

export default TagsInput;
