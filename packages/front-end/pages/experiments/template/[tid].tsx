import { useRouter } from "next/router";
import { FC } from "react";
import { Box, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { useTemplates } from "@/hooks/useTemplates";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Link from "@/components/Radix/Link";
import PageHead from "@/components/Layout/PageHead";
import { useSearch } from "@/services/search";

const TemplatePage: FC = () => {
  const router = useRouter();
  const { tid } = router.query;
  const { templatesMap, templateExperimentMap } = useTemplates();

  const template = templatesMap.get(tid as string);
  const templateExperiments = templateExperimentMap[tid as string] || [];

  const { items: experiments, SortableTH } = useSearch({
    items: templateExperiments,
    defaultSortField: "name",
    localStorageKey: "template-experiments",
    searchFields: ["name"],
  });

  if (!template) {
    return <div>Template not found</div>;
  }

  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Experiments",
            href: `/experiments`,
          },
          {
            display: "Templates",
            href: `/experiments#templates`,
          },
          { display: template.templateMetadata.name },
        ]}
      />
      <div className="container-fluid pagecontents p-3">
        <Box mb="5">
          <h1>{template?.templateMetadata.name}</h1>
          <Text as="p">
            The experiments listed below are using this template. Some fields
            may have been overridden by users and differ from the template.
          </Text>
        </Box>

        <table className="appbox table gbtable">
          <th>Experiment Name</th>
          <SortableTH field="status">Status</SortableTH>
          <SortableTH field="dateCreated">Created</SortableTH>
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
                <td data-title="Experiment Name" className="col-4">
                  <Link href={`/experiment/${e.id}`}>{e.name}</Link>
                </td>
                <td data-title="Status">
                  {<ExperimentStatusIndicator experimentData={e} />}
                </td>
                <td data-title="Created">{date(e.dateCreated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
export default TemplatePage;
