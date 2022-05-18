import { CSSProperties, FC } from "react";
import { useDefinitions } from "../../services/DefinitionsContext";
import MultiSelectField from "../Forms/MultiSelectField";
import { StylesConfig } from "react-select";
import { useDarkText } from "./Tag";

export interface ColorOption {
  readonly value: string;
  readonly label: string;
  readonly color: string;
  readonly isFixed?: boolean;
  readonly isDisabled?: boolean;
}

const TagsInput: FC<{
  onChange: (tags: string[]) => void;
  value: string[];
  autoFocus?: boolean;
  style?: CSSProperties;
  closeMenuOnSelect?: boolean;
}> = ({
  onChange,
  value,
  style = {},
  autoFocus = true,
  closeMenuOnSelect = false,
}) => {
  const { tags } = useDefinitions();

  const dot = (color = "transparent") => ({
    alignItems: "center",
    display: "flex",

    ":before": {
      backgroundColor: color,
      borderRadius: 10,
      content: '" "',
      display: "block",
      marginRight: 8,
      height: 10,
      width: 10,
    },
  });
  const tagStyles: StylesConfig<ColorOption, true> = {
    option: (styles, { data, isDisabled, isFocused, isSelected }) => {
      const displayColor = data.color ?? "#029dd1";
      return {
        ...styles,
        ...dot(data.color),
        backgroundColor: isDisabled
          ? undefined
          : isSelected
          ? displayColor + "20"
          : isFocused
          ? displayColor + "25"
          : displayColor + "00",
        color: isDisabled ? "#ccc" : "#000",
        cursor: isDisabled ? "not-allowed" : "default",

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
          tags.map((t) => {
            return {
              value: t.id,
              label: t.id,
              color: t.color,
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
        placeholder="Tags..."
      />
    </div>
  );
};

export default TagsInput;
