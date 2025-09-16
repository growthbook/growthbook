import { FC, useMemo } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Badge from "@/ui/Badge";

type ExposureQueriesValidationStepProps = {
  dataSource: DataSourceInterfaceWithParams;
};

const ExposureQueriesValidationStep: FC<ExposureQueriesValidationStepProps> = ({
  dataSource,
}) => {
  const exposureQueries = useMemo(
    () => dataSource.settings?.queries?.exposure || [],
    [dataSource.settings?.queries?.exposure],
  );

  return (
    <Box>
      <Flex align="center" gap="3" mb="3">
        <Heading as="h3" size="4" mb="0">
          Experiment Assignment Queries
        </Heading>
        <Badge
          label={String(exposureQueries.length)}
          color="gray"
          radius="medium"
        />
      </Flex>

      {exposureQueries.length === 0 ? (
        <Text size="2" color="gray">
          No experiment assignment queries found for this data source.
        </Text>
      ) : (
        <Box asChild>
          <ul className="mb-0" style={{ paddingLeft: 20 }}>
            {exposureQueries.map((q) => (
              <li key={q.id} style={{ marginBottom: 6 }}>
                <Text size="2" weight="medium">
                  {q.name}
                </Text>
              </li>
            ))}
          </ul>
        </Box>
      )}
    </Box>
  );
};

export default ExposureQueriesValidationStep;
