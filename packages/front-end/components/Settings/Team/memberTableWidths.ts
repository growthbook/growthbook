// These line the member tables up column-for-column, so a table missing Name
// or Last Login hands that width to Email or its single date column instead.
export const MEMBER_COLUMN_WIDTHS = {
  name: "8%",
  email: "19%",
  emailNoName: "27%",
  date: "10%",
  dateOnly: "20%",
  role: "16%",
  projectRoles: "16%",
  environments: "12%",
  teams: "9%",
  actions: "50px",
} as const;
