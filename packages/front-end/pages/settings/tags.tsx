import Link from "next/link";
import { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import TagsModal from "../../components/TagsModal";
import Tag from "../../components/Tag";
import { GBAddCircle } from "../../components/Icons";

const TagsPage: FC = () => {
  const { tags, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<{
    name: string;
    color: string;
    description: string;
  }> | null>(null);

  const tagNameMap = new Map();
  tags.tags.forEach((t) => {
    tagNameMap.set(t, {
      name: t,
      color: tags?.settings?.[t].color ?? "",
      description: tags?.settings?.[t]?.description ?? "",
    });
  });

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
      {tags.tags.length > 0 ? (
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
            {tags.tags.map((t, i) => {
              const attrs = tags?.settings?.[i] ?? {
                color: null,
                description: "",
              };
              return (
                <tr key={i}>
                  <td>{t}</td>
                  <td>{attrs.description}</td>
                  <td>
                    <Tag tag={t} />
                  </td>
                  <td>
                    <button
                      className="btn btn-outline-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setModalOpen(tagNameMap.get(t));
                      }}
                    >
                      <FaPencilAlt />
                    </button>{" "}
                    <DeleteButton
                      displayName="Tag"
                      onClick={async () => {
                        await apiCall(`/tag/${t}`, {
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
        <GBAddCircle /> Add Tag
      </button>
    </div>
  );
};
export default TagsPage;
