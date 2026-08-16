/**
 * Shared widths so these member tables line up column-for-column. A table with
 * no Name column gives that space to Email, and one with a single date column
 * gives it the space Last Login would have taken.
 */
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
