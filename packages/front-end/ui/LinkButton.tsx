import { forwardRef } from "react";
import Link from "next/link";
import Button, { Props as ButtonProps } from "@/ui/Button";

export type Props = {
  href: string;
  external?: boolean;
} & Omit<ButtonProps, "onClick" | "loading" | "setError">;

export default forwardRef<HTMLButtonElement, Props>(function LinkButton(
  { href, external, ...otherProps }: Props,
  ref,
) {
  return (
    <Link href={href} target={external ? "_blank" : "_self"}>
      <Button {...otherProps} ref={ref} />
    </Link>
  );
});
