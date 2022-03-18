import Link from "next/link";
import { Fragment, useState } from "react";
import { FC } from "react";
import { FaAngleRight } from "react-icons/fa";
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from "react-icons/md";
import useApi from "../hooks/useApi";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import { ProjectInterface } from "back-end/types/project";
import NamespaceModal from "../components/Experiment/NamespaceModal";
import { NamespaceUsage } from "back-end/types/organization";
import useOrgSettings from "../hooks/useOrgSettings";
import { findGaps, Ranges } from "../services/features";
import NamespaceUsageGraph from "../components/Features/NamespaceUsageGraph";
import useUser from "../hooks/useUser";

export type NamespaceApiResponse = {
  namespaces: NamespaceUsage;
};

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function getPercentRemaining(ranges: Ranges) {
  return findGaps(ranges).reduce(
    (sum, range) => sum + (range.end - range.start),
    0
  );
}

const NamespacesPage: FC = () => {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`
  );

  const { update } = useUser();
  const { namespaces } = useOrgSettings();

  const [range, setRange] = useState<[number, number] | null>(null);

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
            update();
          }}
        />
      )}
      <h1>Experiment Namespaces</h1>
      <p>Namespaces allow you to run mutually exclusive experiments.</p>
      {namespaces?.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Description</th>
              <th>Num experiments</th>
              <th>Percent remaining</th>
            </tr>
          </thead>
          <tbody>
            {namespaces.map((ns, i) => {
              const experiments = data.namespaces[ns.name] ?? [];
              return (
                <Fragment key={i}>
                  <tr>
                    <td>
                      {experiments.length ? (
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
                          {expanded ? (
                            <MdKeyboardArrowUp />
                          ) : (
                            <MdKeyboardArrowDown />
                          )}
                        </a>
                      ) : (
                        ns.name
                      )}
                    </td>
                    <td>{ns.description}</td>
                    <td>{experiments.length}</td>
                    <td>
                      {percentFormatter.format(
                        getPercentRemaining(
                          experiments.map(({ start, end }) => ({
                            start,
                            end,
                          }))
                        )
                      )}
                    </td>
                  </tr>
                  <tr
                    className="bg-white"
                    style={{ display: expanded === ns.name ? "" : "none" }}
                  >
                    <td colSpan={4} className="pl-5">
                      <NamespaceUsageGraph
                        namespace={ns.name}
                        usage={data?.namespaces || {}}
                        title="Namespace Range"
                        range={range}
                      />
                      {experiments.length > 0 ? (
                        <div
                          onMouseOut={() => {
                            setRange(null);
                          }}
                        >
                          Active Experiments:
                          <ul>
                            {experiments.map((e, i) => {
                              return (
                                <li key={i} className="my-2">
                                  <Link href={`/features/${e.featureId}`}>
                                    <a
                                      onMouseOver={() => {
                                        setRange([e.start, e.end]);
                                      }}
                                    >
                                      {e.featureId} <FaAngleRight />{" "}
                                      {e.environment}{" "}
                                      {e.trackingKey !== e.featureId && (
                                        <>
                                          <FaAngleRight /> {e.trackingKey}
                                        </>
                                      )}
                                    </a>
                                  </Link>{" "}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : (
                        <>
                          This namespace is not used in any experiments
                          currently
                        </>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
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
