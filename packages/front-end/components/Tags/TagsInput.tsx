import { CSSProperties, FC } from "react";
import { useDefinitions } from "../../services/DefinitionsContext";
import MultiSelectField from "../Forms/MultiSelectField";
import { StylesConfig } from "react-select";
import { useDarkText } from "./Tag";
import { TagInterface } from "back-end/types/tag";

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
  style?: CSSProperties;
  closeMenuOnSelect?: boolean;
  tagOptions?: TagInterface[];
  prompt?: string;
}> = ({
  onChange,
  value,
  style = {},
  autoFocus = true,
  closeMenuOnSelect = false,
  tagOptions,
  prompt = "Tags...",
}) => {
  const { tags } = useDefinitions();
  if (!tagOptions) tagOptions = tags;

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
        // add the description after
        ":after": {
          content: `" ${data.desc ? "- " + data.desc : ""} "`,
          display: "inline",
          color: "#777",
          fontSize: "12px",
          paddingLeft: "3px",
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
        color: useDarkText(data.color) ? "#000000" : "#ffffff",
      };
    },
    multiValueLabel: (styles, { data }) => ({
      ...styles,
      color: useDarkText(data.color) ? "#000000" : "#ffffff",
    }),
    multiValueRemove: (styles, { data }) => ({
      ...styles,
      color: useDarkText(data.color) ? "#000000" : "#ffffff",
      ":hover": {
        backgroundColor: data.color + "cc",
      },
    }),
  };

  return (
    <div style={style}>
      <MultiSelectField
        options={
          tagOptions.map((t) => {
            return {
              value: t.id,
              label: t.id,
              color: t.color,
              desc: t.description,
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
      />
    </div>
  );
};

export default TagsInput;
