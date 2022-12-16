import React, { useState } from "react";
import Link from "next/link";
import { PresentationInterface } from "back-end/types/presentation";
import { FaPlus } from "react-icons/fa";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import ShareModal from "../components/Share/ShareModal";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../services/auth";
import { date } from "../services/dates";
import Modal from "../components/Modal";
import CopyToClipboard from "../components/CopyToClipboard";
import { useUser } from "../services/UserContext";

const PresentationPage = (): React.ReactElement => {
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
  const [sharableLinkModal, setSharableLinkModal] = useState(false);
  const [sharableLink, setSharableLink] = useState("");
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<boolean>(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { getUserDisplay, permissions } = useUser();
  const { apiCall } = useAuth();

  const { data: p, error: error, mutate } = useApi<{
    presentations: PresentationInterface[];
    numExperiments: number;
  }>("/presentations");

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred fetching the lists of shares.
      </div>
    );
  }
  if (!p) {
    return <LoadingOverlay />;
  }
  if (!p.presentations.length) {
    return (
      <div className="container p-4">
        <h1>Presentations</h1>
        <p>Auto-generate slide decks to present experiment results.</p>
        <p>
          Present these at all-hands meetings to get the entire company excited
          about experimentation.
        </p>
        <p>
          These are also a great way to generate new experiment ideas as people
          suggest tweaks and follow-up variations.
        </p>

        {permissions.createPresentations && (
          <button
            className="btn btn-success btn-lg"
            onClick={() => {
              setOpenNewPresentationModal(true);
            }}
          >
            <FaPlus /> Add your first presentation
          </button>
        )}
        <ShareModal
          title="New Presentation"
          modalState={openNewPresentationModal}
          setModalState={setOpenNewPresentationModal}
          refreshList={mutate}
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
            <div key={i} className="row d-flex">
              <div className="col flex-grow-1">
                <h4 className="mb-0">{pres.title}</h4>
                <p className="mt-1 mb-0">{pres.description}</p>
              </div>
              <div className="px-4">
                Experiments: {pres?.slides.length || "?"}
                <div className="subtitle text-muted text-sm">
                  <small>
                    <p className="mb-0">
                      Created by: {getUserDisplay(pres?.userId)}
                    </p>
                    <p className="mb-0">on: {date(pres.dateCreated)}</p>
                  </small>
                </div>
              </div>
              <div className="">
                {permissions.createPresentations && (
                  <>
                    <div
                      className="delete delete-right"
                      style={{ lineHeight: "36px" }}
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
                      style={{ lineHeight: "36px" }}
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
                  </>
                )}
                <Link href={`/present/${pres.id}`}>
                  <a
                    className="btn btn-primary mr-3"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Present
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="#fff"
                      height="22"
                      viewBox="0 0 24 24"
                      width="22"
                    >
                      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                    </svg>
                  </a>
                </Link>
                <Link
                  href={`/present/${pres.id}?exportMode=true&printMode=true`}
                >
                  <a
                    className="btn btn-outline-primary mr-3"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print view
                  </a>
                </Link>
                <a
                  className="btn btn-outline-primary mr-3"
                  onClick={(e) => {
                    e.preventDefault();
                    setSharableLink(`/present/${pres.id}`);
                    setSharableLinkModal(true);
                  }}
                >
                  Get link
                </a>
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
          {permissions.createPresentations && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setOpenNewPresentationModal(true);
              }}
            >
              New Presentation
            </button>
          )}
        </div>
      </div>
      <ShareModal
        title="New Presentation"
        modalState={openNewPresentationModal}
        setModalState={setOpenNewPresentationModal}
        refreshList={mutate}
      />
      <ShareModal
        title="Edit Presentation"
        modalState={openEditPresentationModal}
        setModalState={setOpenEditPresentationModal}
        existing={specificPresentation}
        refreshList={mutate}
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
      {sharableLinkModal && (
        <Modal
          open={true}
          header={"Sharable link"}
          close={() => setSharableLinkModal(false)}
          size="md"
        >
          <div className="text-center">
            <div className="text-center mb-2">
              <CopyToClipboard
                text={`${window.location.origin}${sharableLink}?exportMode=true`}
                label="Non-slide version"
                className="justify-content-center"
              />
            </div>
            <div className="text-center mb-2">
              <CopyToClipboard
                text={`${window.location.origin}${sharableLink}`}
                label="Full presentation"
                className="justify-content-center"
              />
            </div>
            <small className="text-muted text-center">
              (Users will need an account on your organization to view)
            </small>
          </div>
        </Modal>
      )}
      {deleteError}
    </>
  );
};
export default PresentationPage;
