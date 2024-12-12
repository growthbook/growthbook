import Link from "next/link";
import Button, { Props as ButtonProps } from "@/components/Radix/Button";

export type Props = {
  href: string;
  external?: boolean;
} & Omit<ButtonProps, "onClick" | "loading" | "setError">;

export default function LinkButton({ href, external, ...otherProps }: Props) {
  return (
    <Link href={href} target={external ? "_blank" : "_self"}>
      <Button {...otherProps} />
    </Link>
  );
}
