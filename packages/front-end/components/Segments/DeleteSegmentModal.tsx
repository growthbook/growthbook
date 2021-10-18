import React, { Fragment, useState } from "react";
import ConfirmModal from "../ConfirmModal";
import { useAuth } from "../../services/auth";
import { SegmentInterface } from "back-end/types/segment";
import { IdeaInterface } from "back-end/types/idea";
import useApi from "../../hooks/useApi";
import { MetricInterface } from "back-end/types/metric";
import LoadingOverlay from "../LoadingOverlay";
import Link from "next/link";

export default function DeleteSegmentModal({
  close,
  success,
  segment,
}: {
  segment: SegmentInterface;
  close: () => void;
  success: () => void;
}) {
  // const [deleteUsage, setDeleteUsage] = useState<{
  //   metrics: number;
  //   ideas: number;
  // }>({ metrics: 0, ideas: 0 });

  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { apiCall } = useAuth();

  const { data, error } = useApi<{
    status: number;
    ideas: IdeaInterface[];
    metrics: MetricInterface[];
    total: number;
  }>(`/segments/${segment.id}/usage`);

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (data.status !== 200) {
    return <div>Sorry, segment not found</div>;
  }
  const metricLinks = [];
  const ideaLinks = [];
  let subtitleText = "This segment is not referenced anywhere else.";
  if (data.total) {
    subtitleText = "This segment is referenced in ";
    const refs = [];
    if (data.metrics.length) {
      refs.push(
        data.metrics.length === 1
          ? "1 metric"
          : data.metrics.length + " metrics"
      );
      data.metrics.forEach((m) => {
        metricLinks.push(
          <Link href="/metric/[mid]" as={`/metric/${m.id}`}>
            <a className="">{m.name}</a>
          </Link>
        );
      });
    }
    if (data.ideas.length) {
      refs.push(
        data.ideas.length === 1 ? "1 idea" : data.ideas.length + " ideas"
      );
      data.ideas.forEach((i) => {
        ideaLinks.push(
          <Link href="/idea/[iid]" as={`/idea/${i.id}`}>
            <a>{i.text}</a>
          </Link>
        );
      });
    }
    subtitleText += refs.join(" and ");
  }
  const confirmDelete = async () => {
    if (deleteLoading) return;
    //console.log("lets delete ", deleteId);
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const res = await apiCall<{ status: number; message?: string }>(
        `/segments/${segment.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({ id: segment.id }),
        }
      );
      if (res.status === 200) {
        setDeleteLoading(false);
        success();
        close();
      } else {
        console.error(res);
        setDeleteError(
          res.message ||
            "There was an error submitting the form. Please try again."
        );
        setDeleteLoading(false);
        //close();
      }
    } catch (e) {
      console.error(e);
      setDeleteError(e.message);
      setDeleteLoading(false);
      close();
    }
  };

  return (
    <>
      <ConfirmModal
        title="Are you sure you want to delete this segment?"
        subtitle={subtitleText}
        yesText="Yes, delete it"
        noText="Never mind"
        modalState={true}
        setModalState={() => {
          close();
        }}
        onConfirm={() => {
          confirmDelete();
        }}
      >
        <div>
          {data.total > 0 && (
            <>
              <div
                className="row mx-2 mb-2 mt-1 py-2"
                style={{ fontSize: "0.8rem", border: "1px solid #eee" }}
              >
                {metricLinks.length > 0 && (
                  <div className="col-6 text-smaller text-left">
                    Metrics:{" "}
                    <ul className="mb-0 pl-3">
                      {metricLinks.map((l, i) => {
                        return (
                          <Fragment key={i}>
                            <li className="">{l}</li>
                          </Fragment>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {ideaLinks.length > 0 && (
                  <div className="col-6 text-smaller text-left">
                    Ideas:{" "}
                    <ul className="mb-0 pl-3">
                      {ideaLinks.map((l, i) => {
                        return (
                          <Fragment key={i}>
                            <li className="">{l}</li>
                          </Fragment>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <p className="mb-0">
                Deleting this segment will remove{" "}
                {data.total === 1 ? "this" : "these"} references
              </p>
            </>
          )}
          <p>This action cannot be undone.</p>
        </div>
      </ConfirmModal>
      {deleteError}
    </>
  );
}
