import { ArchetypeInterface } from "back-end/types/archetype";
import useApi from "@/hooks/useApi";
import Tab from "@/components/Tabs/Tab";
import Tabs from "@/components/Tabs/Tabs";
import { SimulateFeatureValues } from "@/components/Archetype/SimulateFeatureValues";
import { ArchetypeList } from "@/components/Archetype/ArchetypeList";

const ArchetypesPage = (): React.ReactElement => {
  // get all the archetypes:
  const { data, error: archErrors, mutate } = useApi<{
    archetype: ArchetypeInterface[];
  }>("/archetype");

  const archetypes = data?.archetype || [];

  return (
    <>
      <div className="container-fluid pagecontents pt-4">
        <Tabs defaultTab="members" newStyle={true}>
          <Tab
            anchor="archetypes"
            id="archetypes"
            display="Archetypes"
            padding={false}
          >
            <ArchetypeList
              archetypes={archetypes}
              archetypeErrors={archErrors}
              mutate={mutate}
            />
          </Tab>
          <Tab
            anchor="simulate"
            id="simulate"
            display="Simulate"
            padding={false}
            lazy
          >
            <SimulateFeatureValues archetypes={archetypes} />
          </Tab>
        </Tabs>
      </div>
    </>
  );
};
export default ArchetypesPage;
