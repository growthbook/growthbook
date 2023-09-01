import { Comment } from "../../types/discussion";

export function sortCommentsByOrder(
  comments: Comment[],
  order: "asc" | "desc"
) {
  const compareDates = (commentA: Comment, commentB: Comment) => {
    const dateA = new Date(commentA.date).getTime();
    const dateB = new Date(commentB.date).getTime();

    return order === "asc" ? dateA - dateB : dateB - dateA;
  };

  return comments.sort(compareDates);
}
