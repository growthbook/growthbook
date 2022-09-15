import { RequestHandler } from "express";
import { Todo } from "../../../types/todo";
import { todosDb } from "./todos.db";

type GetTodosResponse = {
  todos: Todo[];
};

export const getTodos: RequestHandler<
  Record<string, never>,
  GetTodosResponse
> = (req, res) => {
  return res.json({
    todos: todosDb,
  });
};

type CreateTodoRequest = {
  title: string;
  description: string;
};

export const createTodo: RequestHandler<
  Record<string, never>,
  { todo: Todo },
  CreateTodoRequest
> = (req, res) => {
  const todo = req.body;

  const newTodo = {
    ...todo,
    isCompleted: false,
  };

  todosDb.push(newTodo);

  return res.json({
    todo: newTodo,
  });
};
