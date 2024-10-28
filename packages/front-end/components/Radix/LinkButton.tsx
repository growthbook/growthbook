import Link from "next/link";
import Button, { Props as ButtonProps } from "@/components/Radix/Button";

export type Props = {
  href: string;
} & Omit<ButtonProps, "onClick" | "loading" | "setError">;

export default function LinkButton({ href, ...otherProps }: Props) {
  return (
    <Link href={href}>
      <Button {...otherProps} />
    </Link>
  );
}
