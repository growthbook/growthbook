import { GroupInterface } from "back-end/types/group";
import React, { useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import Button from "../components/Button";
import GroupForm from "../components/GroupForm";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import useApi from "../hooks/useApi";
import { ago } from "../services/dates";

export default function GroupsPage() {
  const [groupForm, setGroupForm] = useState<null | Partial<GroupInterface>>(
    null
  );

  const { data, error } = useApi<{ groupsArr: GroupInterface[] }>("/groups"); //TODO: Add types here like in other places

  const groups = data?.groupsArr;

  if (!groups) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      {groupForm && (
        <GroupForm close={() => setGroupForm(null)} current={groupForm} />
      )}
      <div className="row mb-3">
        <div className="col-auto d-flex">
          <h1>Groups</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        <div className="col-auto">
          <Button
            color="primary"
            onClick={async () => {
              setGroupForm({});
            }}
          >
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              <GBAddCircle />
            </span>{" "}
            New Group
          </Button>
        </div>
      </div>
      {error && (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      )}
      {groups.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <p>
              Groups are defined comma separated lists of users based on a
              unique identifier - for example, you might create a list of
              internal users. These groups, used with feature rules, allow you
              allow you to quickly target lists of users.
            </p>
            <table className="table appbox gbtable table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Attribute</th>
                  <th className="d-none d-lg-table-cell">
                    Comma Separated List
                  </th>
                  <th>Date Updated</th>
                  {/* {permissions.createSegments && <th></th>} */}
                </tr>
              </thead>
              <tbody>
                {groups.map((s) => {
                  return (
                    <tr key={s._id}>
                      <td>{s.groupName}</td>
                      <td>{s.owner}</td>
                      <td>{s.attributeKey}</td>
                      {/* TODO: Come back and update the line below to truncate at a certain character length */}
                      <td className="d-none d-md-table-cell">{s.csv}</td>
                      <td>{ago(s.dateUpdated)}</td>
                      {/* {permissions.createSegments && ( */}
                      <td>
                        <a
                          href="#"
                          className="tr-hover text-primary mr-3"
                          title="Edit this segment"
                          onClick={(e) => {
                            e.preventDefault();
                            setGroupForm(s);
                          }}
                        >
                          <FaPencilAlt />
                        </a>
                        {/* <DeleteButton
                          link={true}
                          className={"tr-hover text-primary"}
                          displayName={s.name}
                          title="Delete this segment"
                          getConfirmationContent={getSegmentUsage(s)}
                          onClick={async () => {
                            await apiCall<{
                              status: number;
                              message?: string;
                            }>(`/segments/${s.id}`, {
                              method: "DELETE",
                              body: JSON.stringify({ id: s.id }),
                            });
                            await mutate({});
                          }}
                        /> */}
                      </td>
                      {/* )} */}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {groups.length === 0 && (
        <div className="alert alert-info">
          You don&apos;t have any segments defined yet.{" "}
          {/* {permissions.createSegments && */}
          Click the button above to create your first one.
          {/* } */}
        </div>
      )}
    </div>
  );
}
