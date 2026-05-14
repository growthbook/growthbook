import { FC, useMemo, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ContextualBanditQueryInterface } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { FaPlus } from "react-icons/fa";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { ContextualBanditQueryModal } from "./ContextualBanditQueryModal";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
};

export const ContextualBanditQueries: FC<Props> = ({
  dataSource,
  canEdit = true,
}) => {
  const [showModal, setShowModal] = useState(false);
  const { mutateDefinitions } = useDefinitions();
  const { data, mutate } = useApi<{
    cbaqs: ContextualBanditQueryInterface[];
  }>(`/contextual-bandit-queries?datasource=${dataSource.id}`);

  const cbaqs = useMemo(() => data?.cbaqs || [], [data?.cbaqs]);

  return (
    <Box>
      <Flex align="center" gap="2" mb="3" justify="between">
        <Box>
          <Heading as="h3" size="medium">
            Contextual Bandit Queries
          </Heading>
          <Text size="medium" color="text-low">
            SQL that returns the user assignment rows and attributes used by
            contextual bandit experiments.
          </Text>
        </Box>
        {canEdit && (
          <Button onClick={() => setShowModal(true)}>
            <FaPlus className="mr-1" /> Add
          </Button>
        )}
      </Flex>

      {cbaqs.length === 0 ? (
        <Callout status="info">
          No contextual bandit queries have been added for this datasource.
        </Callout>
      ) : (
        <Flex direction="column" gap="3">
          {cbaqs.map((cbaq) => (
            <Box key={cbaq.id} p="2">
              <Flex justify="between" align="baseline" mb="2">
                <Text weight="medium">{cbaq.name}</Text>
                <Text size="small" color="text-low">
                  {cbaq.attributes.map((a) => a.attribute).join(", ")}
                </Text>
              </Flex>
              <Code
                language="sql"
                code={cbaq.query}
                containerClassName="mb-0"
                expandable
              />
            </Box>
          ))}
        </Flex>
      )}

      {showModal && (
        <ContextualBanditQueryModal
          dataSource={dataSource}
          close={() => setShowModal(false)}
          onCreate={async () => {
            await mutate();
            await mutateDefinitions({});
          }}
        />
      )}
    </Box>
  );
};
