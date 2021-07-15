import React from "react";
import useApi from "../hooks/useApi";
import Link from "next/link";
import { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { LearningInterface } from "back-end/types/insight";
import { PresentationInterface } from "back-end/types/presentation";
//import NewPresentation from "../components/NewPresentation/NewPresentation";
import NewShare from "../components/Share/NewShare";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../services/auth";
import EditPresentation from "../components/EditPresentation/EditPresentation";
import { date } from "../services/dates";
import { FaPlus } from "react-icons/fa";

const SharePage = (): React.ReactElement => {
  const [openNewPresentationModal, setOpenNewPresentationModal] = useState(
    false
  );
  const [
    specificPresentation,
    setSpecificPresentation,
  ] = useState<PresentationInterface | null>(null);
  const [openEditPresentationModal, setOpenEditPresentationModal] = useState(
    false
  );
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<boolean>(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { apiCall } = useAuth();

  const { data: p, error: error, mutate } = useApi<{
    presentations: PresentationInterface[];
    learnings: LearningInterface[];
    numExperiments: number;
  }>("/presentations");

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!p) {
    return <LoadingOverlay />;
  }
  if (!p.presentations.length) {
    return (
      <div className="container p-4">
        <h1>Presentations</h1>
        <p>
          Auto-generate slide decks to present experiment results and insights.
        </p>
        <p>
          Present these at all-hands meetings to get the entire company excited
          about experimentation.
        </p>
        <p>
          These are also a great way to generate new experiment ideas as people
          suggest tweaks and follow-up variations.
        </p>

        <button
          className="btn btn-success btn-lg"
          onClick={() => {
            setOpenNewPresentationModal(true);
          }}
        >
          <FaPlus /> Add your first Presentation
        </button>
        <NewShare
          modalState={openNewPresentationModal}
          setModalState={setOpenNewPresentationModal}
          refreshList={mutate}
          onClose={() => {
            console.log("do something");
          }}
        />
      </div>
    );
  }

  const deleteConfirm = (id: string) => {
    //console.log(id);
    setDeleteId(id);
    setDeleteConfirmModal(true);
  };

  const confirmDelete = async () => {
    if (deleteLoading) return;
    //console.log("lets delete ", deleteId);

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const res = await apiCall<{ status: number; message?: string }>(
        `/presentation/${deleteId}`,
        {
          method: "DELETE",
          body: JSON.stringify({ id: deleteId }),
        }
      );
      if (res.status === 200) {
        setDeleteLoading(false);
        setDeleteConfirmModal(false);

        mutate();
      } else {
        console.error(res);
        setDeleteError(
          res.message ||
            "There was an error submitting the form. Please try again."
        );
        setDeleteLoading(false);
        setDeleteConfirmModal(false);
      }
    } catch (e) {
      console.error(e);
      setDeleteError(e.message);
      setDeleteLoading(false);
      setDeleteConfirmModal(false);
    }
  };

  let presList = [
    <div key={0} className="p-5 text-justify text-center">
      No presentations saved
    </div>,
  ];
  if (p.presentations && p.presentations.length) {
    presList = [];
    p.presentations.map((pres, i) => {
      presList.push(
        <div className="card mt-2" key={`pres-exp-${i}`}>
          <div className="card-body">
            <div key={i} className="row">
              <div className="col">
                <h4 className="mb-0">{pres.title}</h4>
                <div className="subtitle text-muted text-sm">
                  <small>{date(pres.dateCreated)}</small>
                </div>
                <p className="mt-1 mb-0">{pres.description}</p>
              </div>
              <div className="col col-4">
                Experiments: {pres.experimentIds.length}
                <p className="mt-1 mb-0">
                  Insights:{" "}
                  {p.learnings[pres.id] ? p.learnings[pres.id].length : 0}
                </p>
              </div>
              <div className="col col-3">
                <div
                  className="delete delete-right"
                  onClick={() => {
                    deleteConfirm(pres.id);
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="24"
                    viewBox="0 0 24 24"
                    width="24"
                  >
                    <path d="M0 0h24v24H0V0z" fill="none" />
                    <path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z" />
                  </svg>
                </div>
                <div
                  className="edit edit-right"
                  onClick={() => {
                    setSpecificPresentation(pres);
                    setOpenEditPresentationModal(true);
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="24"
                    viewBox="0 0 24 24"
                    width="24"
                  >
                    <path d="M0 0h24v24H0V0z" fill="none" />
                    <path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z" />
                  </svg>
                </div>
                <Link href="/present/[pid]" as={`/present/${pres.id}`}>
                  <a
                    className="btn btn-primary btn-sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Present
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="#fff"
                      height="24"
                      viewBox="0 0 24 24"
                      width="24"
                    >
                      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                    </svg>
                  </a>
                </Link>
              </div>
            </div>
          </div>
        </div>
      );
    });
  }

  return (
    <>
      <div className="container-fluid pagecontents pt-4 shares learnings">
        <div className=" mb-3">
          <div className="share-list mb-3">{presList}</div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setOpenNewPresentationModal(true);
            }}
          >
            New Presentation
          </button>
        </div>
      </div>
      <NewShare
        modalState={openNewPresentationModal}
        setModalState={setOpenNewPresentationModal}
        refreshList={mutate}
        onClose={() => {
          console.log("do something");
        }}
      />
      <EditPresentation
        modalState={openEditPresentationModal}
        setModalState={setOpenEditPresentationModal}
        presentation={specificPresentation}
        onSuccess={mutate}
      />
      <ConfirmModal
        title="Are you sure you want to delete this presentation?"
        subtitle="This action cannot be undone"
        yesText="Yes, delete it"
        noText="Nevermind"
        modalState={deleteConfirmModal}
        setModalState={setDeleteConfirmModal}
        onConfirm={() => {
          confirmDelete();
        }}
      />
      {deleteError}
    </>
  );
};
export default SharePage;
