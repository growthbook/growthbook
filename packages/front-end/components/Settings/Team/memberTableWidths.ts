// Lines the member tables up column-for-column: name + email = emailNoName,
// date + date = dateOnly. Sums to exactly 100% so the fixed layout has no
// spare width to hand to the actions column.
export const MEMBER_COLUMN_WIDTHS = {
  name: "11%",
  email: "15%",
  emailNoName: "26%",
  date: "9%",
  dateOnly: "18%",
  role: "18%",
  projectRoles: "18%",
  teams: "16%",
  // The project page drops Project Roles; Role and Teams split its share.
  roleOnProject: "26%",
  teamsOnProject: "26%",
  // Teams list: its leading columns replace name/email/dates.
  teamName: "14%",
  teamDescription: "18%",
  teamDate: "12%",
  actions: "4%",
} as const;
