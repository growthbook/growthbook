// Lines the member tables up column-for-column. Sums under 100% on purpose:
// actions is a fixed 50px, and a fixed layout squeezes when nothing is spare.
export const MEMBER_COLUMN_WIDTHS = {
  name: "11%",
  email: "16%",
  emailNoName: "26%",
  date: "10%",
  dateOnly: "18%",
  role: "22%",
  projectRoles: "15%",
  teams: "10%",
  actions: "50px",
} as const;
