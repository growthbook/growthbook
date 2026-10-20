import { archiveChanges, metricKey } from "../src/prune";

describe("metricKey", () => {
  it("adds the fact__ prefix only when absent, like bulk import", () => {
    expect(metricKey("revenue")).toBe("fact__revenue");
    expect(metricKey("fact__revenue")).toBe("fact__revenue");
  });
});

describe("archiveChanges", () => {
  const items = [
    { id: "fact__kept", managedBy: "dbt", archived: false },
    { id: "fact__stale", managedBy: "dbt", archived: false },
    { id: "fact__already_archived", managedBy: "dbt", archived: true },
    { id: "fact__returning", managedBy: "dbt", archived: true },
    { id: "fact__manual", managedBy: "", archived: false },
    { id: "fact__official", managedBy: "admin", archived: false },
    { id: "fact__other_api", managedBy: "api", archived: false },
  ];
  const keep = new Set(["kept", "returning"].map(metricKey));

  it("archives stale dbt-managed items and unarchives returning ones", () => {
    expect(archiveChanges(items, keep)).toEqual([
      { id: "fact__stale", archived: true },
      { id: "fact__returning", archived: false },
    ]);
  });

  it("never touches items the dbt sync does not own", () => {
    expect(archiveChanges(items, new Set())).toEqual([
      { id: "fact__kept", archived: true },
      { id: "fact__stale", archived: true },
    ]);
  });
});
