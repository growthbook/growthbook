import { ArchetypeInterface } from "shared/types/archetype";
import React from "react";
import { Box } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { Tabs, TabsTrigger, TabsList, TabsContent } from "@/ui/Tabs";
import { SimulateFeatureValues } from "@/components/Archetype/SimulateFeatureValues";
import { ArchetypeList } from "@/components/Archetype/ArchetypeList";

const ArchetypesPage = (): React.ReactElement => {
  // get all the archetypes:
  const {
    data,
    error: archErrors,
    mutate,
  } = useApi<{
    archetype: ArchetypeInterface[];
  }>("/archetype");

  const archetypes = data?.archetype || [];

  return (
    <>
      <div className="container-fluid pagecontents pt-4">
        <Tabs defaultValue="archetypes" persistInURL={true}>
          <TabsList>
            <TabsTrigger value="archetypes">Archetypes</TabsTrigger>
            <TabsTrigger value="simulate">Simulate</TabsTrigger>
          </TabsList>
          <Box pt="4">
            <TabsContent value="archetypes">
              <ArchetypeList
                archetypes={archetypes}
                archetypeErrors={archErrors}
                mutate={mutate}
              />
            </TabsContent>
            <TabsContent value="simulate">
              <SimulateFeatureValues archetypes={archetypes} />
            </TabsContent>
          </Box>
        </Tabs>
      </div>
    </>
  );
};
export default ArchetypesPage;
