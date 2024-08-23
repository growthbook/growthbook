import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { getMatchingRules, truncateString } from "shared/util";
import Link from "next/link";
import { SavedGroupInterface } from "shared/src/types";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { PiInfoFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useSearch } from "@/services/search";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Button";
import { GBAddCircle } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
}

export default function IdLists({ groups, mutate }: Props) {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateSavedGroup();
  const canUpdate = permissionsUtil.canUpdateSavedGroup();
  const canDelete = permissionsUtil.canDeleteSavedGroup();
  const { apiCall } = useAuth();

  const idLists = useMemo(() => {
    return groups.filter((g) => g.type === "list");
  }, [groups]);

  const { features } = useFeaturesList(false);

  const environments = useEnvironments();

  const {
    hasLargeSavedGroupFeature,
    supportedConnections,
    unsupportedConnections,
  } = useLargeSavedGroupSupport();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  // Get a list of feature ids for every saved group
  // TODO: also get experiments
  const savedGroupFeatureIds = useMemo(() => {
    const map: Record<string, Set<string>> = {};

    features.forEach((feature) => {
      idLists.forEach((group) => {
        const matches = getMatchingRules(
          feature,
          (rule) =>
            rule.condition?.includes(group.id) ||
            rule.savedGroups?.some((g) => g.ids.includes(group.id)) ||
            false,
          environments.map((e) => e.id)
        );

        if (matches.length > 0) {
          map[group.id] = map[group.id] || new Set();
          map[group.id].add(feature.id);
        }
      });
    });
    return map;
  }, [idLists, environments, features]);

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: idLists,
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "attributeKey^2", "owner", "description^2"],
  });

  if (!idLists) return <LoadingOverlay />;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="large-saved-groups"
        />
      )}
      <div className="mb-5 p-3 bg-white appbox border-top-0">
        {savedGroupForm && (
          <SavedGroupForm
            close={() => setSavedGroupForm(null)}
            current={savedGroupForm}
            type="list"
          />
        )}
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">ID Lists</h2>
          </div>
          <div className="flex-1"></div>
          {canCreate ? (
            <div className="col-auto">
              <Button
                color="primary"
                onClick={async () => {
                  setSavedGroupForm({});
                }}
              >
                <GBAddCircle /> Add ID List
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-gray mb-1">
          Specify a list of values to include for an attribute.
        </p>
        <p className="text-gray mb-1">
          For example, create a &quot;Beta Testers&quot; group identified by a
          specific set of <code>device_id</code> values.
        </p>

        {unsupportedConnections.length > 0 ? (
          <LargeSavedGroupPerformanceWarning
            style="text"
            hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
            supportedConnections={supportedConnections}
            unsupportedConnections={unsupportedConnections}
            openUpgradeModal={() => setUpgradeModal(true)}
          />
        ) : (
          <p>
            <PiInfoFill /> Too many large lists will cause too large of a
            payload, and your server may not support it.
          </p>
        )}

        {idLists.length > 0 && (
          <>
            <div className="row mb-4 align-items-center">
              <div className="col-auto">
                <Field
                  prepend={<FaMagnifyingGlass />}
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </div>
            </div>
            <div className="row mb-0">
              <div className="col-12">
                <table className="table gbtable">
                  <thead>
                    <tr>
                      <SortableTH field={"groupName"}>Name</SortableTH>
                      <SortableTH field="attributeKey">Attribute</SortableTH>
                      <th>Description</th>
                      <SortableTH field={"owner"}>Owner</SortableTH>
                      <SortableTH field={"dateUpdated"}>
                        Date Updated
                      </SortableTH>
                      {(canUpdate || canDelete) && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => {
                      return (
                        <tr key={s.id}>
                          <td>
                            <Link
                              className="text-color-primary"
                              key={s.id}
                              href={`/saved-groups/${s.id}`}
                            >
                              {s.groupName}
                            </Link>
                          </td>
                          <td>{s.attributeKey}</td>
                          <td>
                            <div className="d-flex flex-wrap">
                              {truncateString(s.description || "", 40)}
                            </div>
                          </td>
                          <td>{s.owner}</td>
                          <td>{ago(s.dateUpdated)}</td>
                          {canUpdate || canDelete ? (
                            <td style={{ width: 30 }}>
                              <MoreMenu>
                                {canUpdate ? (
                                  <a
                                    href="#"
                                    className="dropdown-item"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSavedGroupForm(s);
                                    }}
                                  >
                                    Edit
                                  </a>
                                ) : null}
                                {canDelete ? (
                                  <DeleteButton
                                    displayName="Saved Group"
                                    className="dropdown-item text-danger"
                                    useIcon={false}
                                    text="Delete"
                                    title="Delete SavedGroup"
                                    onClick={async () => {
                                      await apiCall(`/saved-groups/${s.id}`, {
                                        method: "DELETE",
                                      });
                                      mutate();
                                    }}
                                    getConfirmationContent={getSavedGroupMessage(
                                      savedGroupFeatureIds[s.id]
                                    )}
                                    canDelete={
                                      (savedGroupFeatureIds[s.id]?.size ||
                                        0) === 0
                                    }
                                  />
                                ) : null}
                              </MoreMenu>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {!items.length && isFiltered && (
                      <tr>
                        <td
                          colSpan={canUpdate || canDelete ? 6 : 5}
                          align={"center"}
                        >
                          No matching saved groups
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
