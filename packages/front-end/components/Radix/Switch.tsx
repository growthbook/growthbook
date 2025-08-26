import { PiWarningFill } from "react-icons/pi";
import { Switch as RadixSwitch } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";

type BaseProps = {
  status?: "default" | "warning" | "error";
  label?: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  required?: boolean;
  disabled?: boolean;
  onCheckedChange?(checked: boolean): void;
} & MarginProps;

type PropsWithLabel = BaseProps & {
  label: string;
  description?: string;
};

type PropsWithLabelAndDescription = PropsWithLabel & {
  description: string;
};

export type Props = BaseProps | PropsWithLabel | PropsWithLabelAndDescription;

export default function Switch({
  status = "default",
  label,
  description,
  disabled,
  ...props
}: Props) {
  return (
    <div className="d-flex align-items-center">
      {status === "warning" && (
        <PiWarningFill style={{ color: "var(--amber-11)" }} className="mr-1" />
      )}
      {status === "error" && (
        <PiWarningFill style={{ color: "var(--red-11)" }} className="mr-1" />
      )}
      <RadixSwitch size="2" disabled={disabled} {...props} />
      {label && <span>{label}</span>}
      {description && <span>{description}</span>}
    </div>
  );
}
