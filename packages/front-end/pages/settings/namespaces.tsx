import Link from "next/link";
import { Fragment, useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
//import DeleteButton from "../../components/DeleteButton";
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from "react-icons/md";
import useApi from "../../hooks/useApi";
import { GBAddCircle } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ProjectInterface } from "back-end/types/project";
import NamespaceModal from "../../components/Experiment/NamespaceModal";
import { ExperimentRule } from "back-end/types/feature";
//import { useAuth } from "../../services/auth";

export type NamespaceApiResponse = {
  status: number;
  namespaces: {
    name: string;
    description: string;
    experiments?: {
      enabled: boolean;
      namespace: string;
      range: [number, number];
      experimentRule: ExperimentRule;
      featureId: string;
      experimentKey: string;
    }[];
    rangeRemaining: number;
    largestGapRange: [number, number];
  }[];
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const NamespacesPage: FC = () => {
  const { data, error, mutate } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`
  );

  //const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );
  const [expanded, setExpanded] = useState(null);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <NamespaceModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => {
            mutate();
          }}
        />
      )}
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Experiment Namespaces</h1>
      <p>Namespaces allow you to run mutually exclusive experiments.</p>
      {data.namespaces.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Description</th>
              <th>Num experiments</th>
              <th>Percent remaining</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.namespaces.map((ns, i) => (
              <Fragment key={i}>
                <tr>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (expanded) {
                          setExpanded(null);
                        } else {
                          setExpanded(ns.name);
                        }
                      }}
                    >
                      {ns.name}{" "}
                      {ns.experiments.length > 0 ? (
                        expanded ? (
                          <MdKeyboardArrowUp />
                        ) : (
                          <MdKeyboardArrowDown />
                        )
                      ) : (
                        <></>
                      )}
                    </a>
                  </td>
                  <td>{ns.description}</td>
                  <td>{ns.experiments.length}</td>
                  <td>{percentFormatter.format(ns.rangeRemaining)}</td>
                  <td>
                    <button
                      className="btn btn-outline-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setModalOpen(ns);
                      }}
                    >
                      <FaPencilAlt />
                    </button>{" "}
                    {/* Deleting namespaces requires deleting it in all the features */}
                    {/*<DeleteButton*/}
                    {/*  displayName="project"*/}
                    {/*  onClick={async () => {*/}
                    {/*    await apiCall(`/projects/${p.id}`, {*/}
                    {/*      method: "DELETE",*/}
                    {/*    });*/}
                    {/*    mutateDefinitions();*/}
                    {/*  }}*/}
                    {/*/>*/}
                  </td>
                </tr>
                <tr style={{ display: expanded === ns.name ? "" : "none" }}>
                  <td colSpan={5} className="">
                    {ns.experiments.length > 0 ? (
                      <div className="position-relative">
                        <a
                          href="#"
                          style={{
                            position: "absolute",
                            top: "0",
                            right: "0",
                            zIndex: 1000,
                          }}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            setExpanded(null);
                          }}
                        >
                          X
                        </a>
                        {ns.experiments.map((e, i) => {
                          return (
                            <div key={i} className="row">
                              <div className="col-4 px-4">
                                <Link href={`/features/${e.featureId}`}>
                                  <a>{e.experimentKey}</a>
                                </Link>
                              </div>
                              <div className="col-1">
                                {percentFormatter.format(
                                  e.range[1] - e.range[0]
                                )}
                              </div>
                              <div className="col-1">
                                <span>
                                  {e.enabled ? "enabled" : "disabled"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        This namespace is not used in any experiments currently
                      </>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <></>
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen({});
        }}
      >
        <GBAddCircle /> Create Namespace
      </button>
    </div>
  );
};
export default NamespacesPage;
