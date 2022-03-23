import Link from "next/link";
import { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import TagsModal from "../../components/Tags/TagsModal";
import Tag from "../../components/Tags/Tag";
import { GBAddCircle } from "../../components/Icons";

const TagsPage: FC = () => {
  const { tags, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<{
    name: string;
    color: string;
    description: string;
  }> | null>(null);

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <TagsModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Tags</h1>
      <p>Organize features, experiments, metrics, etc. with tags.</p>
      {tags?.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Tag name</th>
              <th>Description</th>
              <th>Preview</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {tags?.map((t, i) => {
              return (
                <tr key={i}>
                  <td
                    onClick={(e) => {
                      e.preventDefault();
                      setModalOpen(t);
                    }}
                    className="cursor-pointer"
                  >
                    {t.id}
                  </td>
                  <td>{t.description}</td>
                  <td>
                    <Tag tag={t.id} />
                  </td>
                  <td>
                    <button
                      className="btn btn-outline-primary tr-hover"
                      onClick={(e) => {
                        e.preventDefault();
                        setModalOpen(t);
                      }}
                    >
                      <FaPencilAlt />
                    </button>{" "}
                    <DeleteButton
                      deleteMessage="Are you sure? Deleting a tag will remove it from all features, metrics, and experiments."
                      className="tr-hover"
                      displayName="Tag"
                      onClick={async () => {
                        await apiCall(`/tag/${t.id}`, {
                          method: "DELETE",
                        });
                        mutateDefinitions();
                      }}
                    />
                  </td>
                </tr>
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
        <span className="h4 pr-2 m-0 d-inline-block">
          <GBAddCircle />
        </span>{" "}
        Add Tag
      </button>
    </div>
  );
};
export default TagsPage;
