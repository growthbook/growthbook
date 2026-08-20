// These line the member tables up column-for-column, so a table missing Name
// or Last Login hands that width to Email or its single date column instead.
// Sums under 100% on purpose: the actions column is a fixed 50px, and a fixed
// layout squeezes every column when the percentages leave it no room.
export const MEMBER_COLUMN_WIDTHS = {
  name: "11%",
  email: "19%",
  emailNoName: "26%",
  date: "12%",
  dateOnly: "18%",
  role: "11%",
  projectRoles: "10%",
  environments: "9%",
  teams: "10%",
  actions: "50px",
} as const;
