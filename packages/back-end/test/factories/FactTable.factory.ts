import { Factory } from "fishery";
import { FactTableInterface } from "shared/types/fact-table";

export const factTableFactory = Factory.define<FactTableInterface>(
  ({ sequence, params }) => ({
    id: `ft_${sequence}`,
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Fact Table",
    description: "A test fact table",
    owner: "test-owner",
    projects: [],
    tags: [],
    datasource: "test-datasource",
    userIdTypes: ["user_id", "anonymous_id"],
    sql: "SELECT user_id, anonymous_id, timestamp, value FROM events",
    eventName: "",
    columns: [],
    filters: params.filters ?? [],
  }),
);
