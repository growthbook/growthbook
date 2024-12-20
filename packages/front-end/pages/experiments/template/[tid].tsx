import { useRouter } from "next/router";
import { FC } from "react";
import { Box, Text } from "@radix-ui/themes";
import { useTemplates } from "@/hooks/useTemplates";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

const TemplatePage: FC = () => {
  const router = useRouter();
  const { tid } = router.query;
  const { templatesMap, templateExperimentMap } = useTemplates();

  const template = templatesMap.get(tid as string);
  const experiments = templateExperimentMap[tid as string] || [];

  return (
    <div className="container-fluid pagecontents p-3">
      <Box mb="5">
        <h1>{template?.templateMetadata.name}</h1>
        <Text as="p">
          The experiments listed below are using this template. Some fields may
          have been overridden by users and differ from the template.
        </Text>
      </Box>

      <table className="appbox table gbtable responsive-table">
        <th>Experiment Name</th>
        <th>Status</th>
        <tbody>
          {experiments.map((e) => (
            <tr
              key={e.id}
              className="hover-highlight"
              onClick={(event) => {
                event.preventDefault();
                router.push(`/experiment/${e.id}`);
              }}
            >
              <td data-title="Experiment Name">{e.name}</td>
              <td data-title="Status">
                {<ExperimentStatusIndicator status={e.status} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
export default TemplatePage;
