import { forwardRef, ReactNode } from "react";
import { Box, BoxProps } from "@radix-ui/themes";

export default forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    noBackground?: boolean;
    className?: string;
  } & BoxProps
>(function Frame(
  { children, noBackground, className, ...containerProps },
  ref,
) {
  return (
    <Box
      ref={ref}
      mb="4"
      py="5"
      px="6"
      className={`appbox ${noBackground ? "nobg" : ""} ${
        className ? className : ""
      }`}
      {...containerProps}
    >
      {children}
    </Box>
  );
});
