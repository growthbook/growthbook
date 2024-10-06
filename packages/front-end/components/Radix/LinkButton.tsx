import Link from "next/link";
import Button, { Props as ButtonProps } from "@/components/Radix/Button";

export type Color = "violet" | "red";
export type Variant = "solid" | "soft" | "outline" | "ghost";
export type Size = "xs" | "sm" | "md" | "lg";

export type Props = {
  href: string;
} & ButtonProps;

export default function LinkButton({ href, children, ...otherProps }: Props) {
  return (
    <Link href={href}>
      <Button {...otherProps}>{children}</Button>
    </Link>
  );
}
