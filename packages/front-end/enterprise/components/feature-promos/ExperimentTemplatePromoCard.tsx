import { Box, Flex, Text } from "@radix-ui/themes";
import Button from "@/components/Radix/Button";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

export default function ExperimentTemplatePromoCard({
  hasFeature,
}: {
  hasFeature: boolean;
}) {
  return (
    <Flex
      maxWidth="700px"
      className="appbox py-4"
      style={{ paddingLeft: "32px", paddingRight: "32px", border: "none" }}
    >
      <Box width="100%" height="100%">
        <img
          className="rounded"
          src={"/images/experiment-templates.jpeg"} //MKTODO: Change this with the actual image when ready
          alt={"test"}
          style={{
            height: "150px",
            maxWidth: "268px",
            objectFit: "cover",
          }}
        />
      </Box>
      <Flex className="pl-4" direction="column" justify="center">
        <Box>
          <h3>
            <Flex align="center">
              Experiment Templates{" "}
              <PaidFeatureBadge commercialFeature="templates" />
            </Flex>
          </h3>
          <Text as="p">
            Experiment Templates can help enforce consistency and best practices
            as you scale up experimentation.
          </Text>
          {hasFeature ? (
            <a href={"/experiments#templates"}>
              <Button>Create Template</Button>
            </a>
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
