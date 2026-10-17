import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";

/** The 40px band atop a review's actions card, tinted by its status. */
export default function CardHeader({
  children,
  background,
}: {
  children: ReactNode;
  background?: string;
}) {
  return (
    <Flex
      align="center"
      px="4"
      style={{
        background,
        borderBottom: "1px solid var(--gray-a4)",
        minHeight: 40,
      }}
    >
      {children}
    </Flex>
  );
}
