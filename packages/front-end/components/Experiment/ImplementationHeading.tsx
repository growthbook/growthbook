import { ReactNode } from "react";
import Text, { TextProps } from "@/ui/Text";

/** Labels one kind of implementation on the Setup page: flags, redirects, visual changes. */
export default function ImplementationHeading({
  children,
  mt = "4",
  mb = "2",
}: {
  children: ReactNode;
  mt?: TextProps["mt"];
  mb?: TextProps["mb"];
}) {
  return (
    <Text
      as="div"
      weight="medium"
      color="text-low"
      textTransform="uppercase"
      mt={mt}
      mb={mb}
    >
      {children}
    </Text>
  );
}
