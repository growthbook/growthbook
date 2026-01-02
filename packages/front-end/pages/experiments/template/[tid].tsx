import { useRouter } from "next/router";
import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import { useTemplates } from "@/hooks/useTemplates";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import { useSearch } from "@/services/search";
import Button from "@/ui/Button";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import { useUser } from "@/services/UserContext";
import LinkButton from "@/ui/LinkButton";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";

const TemplatePage: FC = () => {
  const router = useRouter();
  const { tid } = router.query;
  const { templatesMap, templateExperimentMap } = useTemplates();
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [openTemplateModal, setOpenTemplateModal] = useState<
    ExperimentTemplateInterface | undefined
  >(undefined);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { hasCommercialFeature, permissionsUtil } = useUser();

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

  const hasTemplatesFeature = hasCommercialFeature("templates");
  const canCreate =
    permissionsUtil.canCreateExperimentTemplate({
      project: template?.project,
    }) && hasTemplatesFeature;
  const canEdit =
    permissionsUtil.canUpdateExperimentTemplate(template, {}) &&
    hasTemplatesFeature;

  return (
    <>
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="experiment-list"
          isNewExperiment={true}
          initialValue={{
            type: "standard",
            templateId: tid as string,
          }}
        />
      )}
      {openTemplateModal && (
        <TemplateForm
          onClose={() => setOpenTemplateModal(undefined)}
          initialValue={openTemplateModal}
          source="templates-list"
          isNewTemplate={false}
        />
      )}
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
        <Box mb="5" mt="3">
          <Flex mt="2" mb="1" justify="between" align="center">
            <h1>{template?.templateMetadata.name}</h1>
            <div>
              {canEdit && (
                <Button
                  onClick={() => setOpenTemplateModal(template)}
                  variant="outline"
                >
                  Edit Template
                </Button>
              )}
              {canCreate && (
                <Button onClick={() => setOpenNewExperimentModal(true)} ml="3">
                  Create Experiment
                </Button>
              )}
            </div>
          </Flex>
          <Text as="p">
            The experiments listed below are using this template. Some fields
            may have been overridden by users and differ from the template.
          </Text>
        </Box>
        {experiments.length ? (
          <table className="appbox table gbtable">
            <thead>
              <tr>
                <th>Experiment Name</th>
                <SortableTH field="status">Status</SortableTH>
                <SortableTH field="dateCreated">Created</SortableTH>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e) => (
                <tr
                  key={e.id}
                  className="hover-highlight"
                  onClick={(event) => {
                    event.preventDefault();
                    router.push(`/experiment/${e.id}`);
                  }}
                  style={{ cursor: "pointer" }}
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
        ) : (
          <>
            {showUpgradeModal && (
              <UpgradeModal
                close={() => setShowUpgradeModal(false)}
                source="templates"
                commercialFeature="templates"
              />
            )}
            <div className="appbox p-5 text-center">
              <h1>Create an Experiment from this Template</h1>
              <Text size="3">
                Save time configuring experiment details, and ensure consistency
                across your team and projects.
              </Text>
              <div className="mt-3">
                <LinkButton
                  href="https://docs.growthbook.io/running-experiments/experiment-templates"
                  variant="outline"
                  mr="3"
                  external={true}
                >
                  View docs
                </LinkButton>
                {canCreate ? (
                  <Button onClick={() => setOpenNewExperimentModal(true)}>
                    Create Experiment
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setShowUpgradeModal(true);
                    }}
                  >
                    Upgrade Plan
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};
export default TemplatePage;
