import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function DataSourceOptionPricing({
  headline,
  detail,
  footnote,
}: {
  headline: string;
  detail: string | null;
  footnote: string | null;
}) {
  return (
    <>
      <Heading as="h3" size="sm" mt="5" mb="2">
        Pricing
      </Heading>
      <Flex
        align="center"
        justify="between"
        gap="3"
        wrap="wrap"
        p="3"
        style={{
          background: "var(--violet-a2)",
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-3)",
        }}
      >
        <Box>
          <Text as="div" weight="semibold">
            {headline}
          </Text>
          {detail ? (
            <Text as="div" color="text-mid">
              {detail}
            </Text>
          ) : null}
        </Box>
        <Link href="https://www.growthbook.io/pricing" external>
          Pricing details <PiArrowSquareOut />
        </Link>
      </Flex>
      {footnote ? (
        <Text as="p" size="sm" color="text-mid" mt="2">
          {footnote}
        </Text>
      ) : null}
    </>
  );
}
