import {
  countries,
  getCountryFlagEmojiFromCountryCode,
} from "country-codes-flags-phone-codes";
import type { MultiSelectFieldProps } from "@/ui/MultiSelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import type { SelectFieldProps } from "./SelectField";
import SelectField from "./SelectField";

export const ALL_COUNTRY_CODES = countries.map((country) => country.code);

interface CountrySelectorBaseProps {
  displayFlags: boolean;
}
type SingleCountrySelectorProps = Omit<SelectFieldProps, "options"> & {
  selectAmount: "single";
} & CountrySelectorBaseProps;
type MultiCountrySelectorProps = Omit<MultiSelectFieldProps, "options"> & {
  selectAmount: "multi";
} & CountrySelectorBaseProps;
type CountrySelectorProps =
  | SingleCountrySelectorProps
  | MultiCountrySelectorProps;

export default function CountrySelector(props: CountrySelectorProps) {
  const options = countries.map((country) => ({
    label: country.name,
    value: country.code,
  }));

  const formatOptionLabel = ({ label, value }, { context }) => {
    const text = context === "menu" ? `${label} (${value})` : value;
    const flag = getCountryFlagEmojiFromCountryCode(value);
    return `${props.displayFlags && flag ? flag + " " : ""}${text}`;
  };

  if (props.selectAmount === "single") {
    return (
      <SelectField
        size="legacy"
        options={options}
        formatOptionLabel={formatOptionLabel}
        {...props}
      />
    );
  } else {
    return (
      <MultiSelectField
        legacyHeight
        options={options}
        formatOptionLabel={formatOptionLabel}
        {...props}
      />
    );
  }
}
