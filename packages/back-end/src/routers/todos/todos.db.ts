import { Todo } from "../../../types/todo";

export const todosDb: Todo[] = [
  {
    title: "Router proof of concept",
    description: "Create a proof of concept example using Express Routers",
    isCompleted: true,
  },
  {
    title: "Request validation example",
    description: "Create a proof of concept including request validation",
    isCompleted: false,
  },
  {
    title: "Express routers",
    description: "Migrate all controllers to use Express routers",
    isCompleted: false,
  },
];
