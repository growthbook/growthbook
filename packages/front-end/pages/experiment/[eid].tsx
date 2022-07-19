import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import React, { ReactElement } from "react";
import useSwitchOrg from "../../services/useSwitchOrg";
import { IdeaInterface } from "back-end/types/idea";
import SinglePage from "../../components/Experiment/SinglePage";
import MultiTabPage from "../../components/Experiment/MultiTabPage";
import { useLocalStorage } from "../../hooks/useLocalStorage";

const ExperimentPage = (): ReactElement => {
  const router = useRouter();
  const { eid } = router.query;

  const [useSinglePage, setUseSinglePage] = useLocalStorage(
    "new-exp-page-layout",
    false
  );

  const { data, error, mutate } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
  }>(`/experiment/${eid}`);

  useSwitchOrg(data?.experiment?.organization);

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const { experiment, idea } = data;

  // TODO: more cases where the new page won't work?
  const supportsSinglePage = experiment.implementation !== "visual";

  return (
    <div>
      {supportsSinglePage &&
        (useSinglePage ? (
          <div className="bg-light border-bottom p-1 text-center">
            <span>
              You are viewing the new experiment page layout.{" "}
              <strong>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setUseSinglePage(false);
                  }}
                >
                  Switch Back
                </a>
              </strong>
            </span>
          </div>
        ) : (
          <div className="bg-purple text-light p-1 text-center">
            <span>
              Preview the new experiment page layout!{" "}
              <strong>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setUseSinglePage(true);
                  }}
                >
                  Switch Now
                </a>
              </strong>
            </span>
          </div>
        ))}
      {useSinglePage ? (
        <SinglePage experiment={experiment} mutate={mutate} />
      ) : (
        <MultiTabPage experiment={experiment} idea={idea} mutate={mutate} />
      )}
    </div>
  );
};

export default ExperimentPage;
