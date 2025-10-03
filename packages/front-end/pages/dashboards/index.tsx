import { ago } from "shared/dates";
import { FaMagnifyingGlass } from "react-icons/fa6";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDashboards } from "@/hooks/useDashboards";
import { useSearch } from "@/services/search";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";

export default function DashboardsPage() {
  const { dashboards, loading, error } = useDashboards(true);
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: dashboards,
    localStorageKey: "dashboards",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["title"],
  });

  if (loading) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      <div className="row">
        <div className="col">
          <h1>Dashboards</h1>
        </div>
      </div>

      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of dashboards.
        </div>
      ) : (
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
                    <SortableTH field={"title"}>Title</SortableTH>
                    <th>Owner</th>
                    <SortableTH field={"dateCreated"}>Date Created</SortableTH>
                    <SortableTH field={"dateUpdated"}>Date Updated</SortableTH>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => {
                    return (
                      <tr key={d.id}>
                        <td>
                          <Link
                            className="text-color-primary"
                            key={d.id}
                            href={`/dashboards/${d.id}`}
                          >
                            {d.title}
                          </Link>
                        </td>
                        <td>{d.userId}</td>
                        <td>{ago(d.dateCreated)}</td>
                        <td>{ago(d.dateUpdated)}</td>
                        <td style={{ width: 30 }}>
                          <MoreMenu>Hi</MoreMenu>
                        </td>
                      </tr>
                    );
                  })}
                  {!items.length && isFiltered && (
                    <tr>
                      <td colSpan={5} align={"center"}>
                        No matching dashboards
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
  );
}
