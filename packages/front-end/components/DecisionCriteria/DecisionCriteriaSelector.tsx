import { FC, useEffect, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { DecisionCriteriaInterface } from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import { useAuth } from "@/services/auth";
import SelectField from "@/components/Forms/SelectField";

interface DecisionCriteriaSelectorProps {
  value: string;
  onChange: (value: string) => void;
  project?: string;
}

const DecisionCriteriaSelector: FC<DecisionCriteriaSelectorProps> = ({
  value,
  onChange,
  project,
}) => {
  const { apiCall } = useAuth();
  const [decisionCriterias, setDecisionCriterias] = useState<DecisionCriteriaInterface[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDecisionCriterias = async () => {
      try {
        setLoading(true);
        const response = await apiCall<{
          status: number;
          decisionCriteria: DecisionCriteriaInterface[];
        }>("/decision-criteria");
        if (response?.decisionCriteria) {
          setDecisionCriterias(response.decisionCriteria);
        }
      } catch (error) {
        console.error("Error fetching decision criteria:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDecisionCriterias();
  }, [apiCall, project]);

  if (loading) {
    return <div>Loading decision criteria...</div>;
  }

  return (
    <SelectField
      value={value}
      onChange={onChange}
      options={decisionCriterias.map((criteria) => ({
        value: criteria.id,
        label: criteria.name,
      }))}
      initialOption="None"
      formatOptionLabel={({ label, value }) => {
        const criteria = decisionCriterias.find(c => c.id === value);
        return (
          <Flex direction="column" gap="1">
            <Text>{label}</Text>
            {criteria?.description && (
              <Text size="1" color="gray">
                {criteria.description}
              </Text>
            )}
          </Flex>
        );
      }}
    />
  );
};

export default DecisionCriteriaSelector; 