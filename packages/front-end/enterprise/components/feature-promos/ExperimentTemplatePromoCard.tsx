import { Box, Flex, Text } from "@radix-ui/themes";
import Button from "@/components/Radix/Button";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

export default function ExperimentTemplatePromoCard({
  hasFeature,
  onClick,
}: {
  hasFeature: boolean;
  onClick?: () => void;
}) {
  return (
    <Flex
      gap="6"
      direction="column"
      className="appbox p-4 flex-sm-row"
      style={{
        paddingLeft: "32px",
        paddingRight: "32px",
        border: "none",
        maxWidth: "700px",
      }}
    >
      <Flex justify="center">
        <img
          className="rounded"
          src={"/images/experiment-templates.png"}
          alt={"GrowthBook Experiment Templates Promo Image"}
          style={{
            height: "150px",
            maxWidth: "268px",
            objectFit: "cover",
          }}
        />
      </Flex>
      <Flex align="center" className="md-pl-4">
        <Box>
          <PaidFeatureBadge commercialFeature="templates" mr="2" />
          <h3 className="pt-2">Experiment Templates</h3>
          <Text as="p">
            Experiment Templates can help enforce consistency and best practices
            as you scale up experimentation.
          </Text>
          {hasFeature ? (
            <Button onClick={onClick}>Create Template</Button>
          ) : (
            <a
              href={"https://www.growthbook.io/demo"}
              target="_blank"
              rel="noreferrer"
            >
              <Button>Contact Sales</Button>
            </a>
          )}
        </Box>
      </Flex>
    </Flex>
  );
}
