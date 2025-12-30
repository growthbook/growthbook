import { vi } from "vitest";
import { enqueueTasks, QueueTask, TaskResult } from "@/services/async-queue";
import { deepFreeze } from "@/test/test-helpers";

describe("async queue", () => {
  type MyMockDataType = { n: number };
  type MyMockResultType = { echo: string };

  const tasks: QueueTask<MyMockDataType>[] = [
    {
      id: "one",
      data: { n: 1 },
    },
    {
      id: "two",
      data: { n: 2 },
    },
    {
      id: "three",
      data: { n: 3 },
    },
    {
      id: "four",
      data: { n: 4 },
    },
  ];

  beforeEach(() => {
    deepFreeze(tasks);
  });

  it("should enqueue provided tasks and call them with the provided delay", async () => {
    const mockPerformAsync = vi.fn(
      (data: MyMockDataType): Promise<TaskResult<MyMockResultType>> => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: "success",
              data: {
                echo: `the number is ${data.n}`,
              },
            });
          }, 200);
        });
      },
    );

    const mockOnProgress = vi.fn(
      (taskId: string, result: TaskResult<MyMockResultType>) => {
        console.log(
          `task '${taskId}' completed with result: '${JSON.stringify(result)}'`,
        );
      },
    );

    const result = await enqueueTasks<MyMockDataType, MyMockResultType>(tasks, {
      perform: mockPerformAsync,
      onProgress: mockOnProgress,
    });

    expect(result.completed).toEqual([
      {
        id: "one",
        result: {
          data: {
            echo: "the number is 1",
          },
          status: "success",
        },
      },
      {
        id: "two",
        result: {
          data: {
            echo: "the number is 2",
          },
          status: "success",
        },
      },
      {
        id: "three",
        result: {
          data: {
            echo: "the number is 3",
          },
          status: "success",
        },
      },
      {
        id: "four",
        result: {
          data: {
            echo: "the number is 4",
          },
          status: "success",
        },
      },
    ]);
    expect(result.failed).toEqual([]);
    // perform function is called
    expect(mockPerformAsync.mock.calls).toHaveLength(4);
    // Progress is called
    expect(mockOnProgress.mock.calls).toHaveLength(4);
    expect(mockOnProgress.mock.calls[0][0]).toEqual("one");
    expect(mockOnProgress.mock.calls[0][1]).toEqual({
      status: "success",
      data: { echo: "the number is 1" },
    });
    expect(mockOnProgress.mock.calls[1][0]).toEqual("two");
    expect(mockOnProgress.mock.calls[1][1]).toEqual({
      status: "success",
      data: { echo: "the number is 2" },
    });
    expect(mockOnProgress.mock.calls[2][0]).toEqual("three");
    expect(mockOnProgress.mock.calls[2][1]).toEqual({
      status: "success",
      data: { echo: "the number is 3" },
    });
    expect(mockOnProgress.mock.calls[3][0]).toEqual("four");
    expect(mockOnProgress.mock.calls[3][1]).toEqual({
      status: "success",
      data: { echo: "the number is 4" },
    });
  });

  describe("when tasks fail", () => {
    it("should record the failures and retry relevant tasks", async () => {
      const mockPerformAsync = vi.fn<
        (data: MyMockDataType) => Promise<TaskResult<MyMockResultType>>
      >((data) => {
        return new Promise<TaskResult<MyMockResultType>>((resolve) => {
          setTimeout(() => {
            const result: TaskResult<MyMockResultType> = {
              status:
                data.n % 2 === 0 ? "success" : data.n === 1 ? "retry" : "fail",
              data:
                data.n % 2 === 0
                  ? { echo: `the number is ${data.n}` }
                  : undefined,
              error:
                data.n % 2 !== 0
                  ? "This task was programmed to: " +
                    (data.n === 1 ? "retry" : "fail")
                  : undefined,
            } as TaskResult<MyMockResultType>;
            resolve(result);
          }, 200);
        });
      });

      const mockOnProgress = vi.fn<
        (taskId: string, result: TaskResult<MyMockResultType>) => void
      >((taskId, result) => {
        console.log(
          `task '${taskId}' completed with result: '${JSON.stringify(result)}'`,
        );
      });

      const result = await enqueueTasks<MyMockDataType, MyMockResultType>(
        tasks,
        {
          perform: mockPerformAsync,
          onProgress: mockOnProgress,
        },
        {
          retryCount: 2,
          delayMs: 100,
        },
      );

      // correct results
      expect(result.completed).toEqual([
        {
          id: "two",
          result: {
            data: {
              echo: "the number is 2",
            },
            status: "success",
          },
        },
        {
          id: "four",
          result: {
            data: {
              echo: "the number is 4",
            },
            status: "success",
          },
        },
      ]);
      expect(result.failed).toEqual([
        {
          id: "three",
          result: {
            status: "fail",
            error: "This task was programmed to: fail",
          },
        },
        {
          id: "one",
          result: {
            status: "retry",
            error: "This task was programmed to: retry",
          },
        },
      ]);
      expect(mockOnProgress.mock.calls).toHaveLength(4);
      // the first call to onProgress is the successful task 'two' since 'one' needs to be retried
      expect(mockOnProgress.mock.calls[0][0]).toEqual("two");
      expect(mockOnProgress.mock.calls[0][1]).toEqual({
        status: "success",
        data: { echo: "the number is 2" },
      });
      // the first task to immediately fail ('one') will progress next
      expect(mockOnProgress.mock.calls[1][0]).toEqual("three");
      expect(mockOnProgress.mock.calls[1][1]).toEqual({
        status: "fail",
        error: "This task was programmed to: fail",
      });
      // the next one to succeed is the other even task 'four' since 'three' is odd and fails
      expect(mockOnProgress.mock.calls[2][0]).toEqual("four");
      expect(mockOnProgress.mock.calls[2][1]).toEqual({
        status: "success",
        data: { echo: "the number is 4" },
      });
      // task 'one' always retries and eventually fails
      expect(mockOnProgress.mock.calls[3][0]).toEqual("one");
      expect(mockOnProgress.mock.calls[3][1]).toEqual({
        error: "This task was programmed to: retry",
        status: "retry",
      });
      // perform is called 6 times:
      //  1. one - this task retries
      //  2. two - this task succeeds
      //  3. three - this task fails permanently
      //  4. four - this task succeeds
      //  5. one - this task retries (attempt 2)
      //  6. one - this task retries (attempt 3)
      expect(mockPerformAsync.mock.calls).toHaveLength(6);
    });
  });

  describe("when tasks fail with an uncaught exception", () => {
    it("should retry tasks with failed exceptions", async () => {
      const mockPerformAsync = vi.fn<
        (data: MyMockDataType) => Promise<TaskResult<MyMockResultType>>
      >(async (data) => {
        if (data.n === 2) {
          throw new Error("cannot perform two (2)");
        }

        return {
          status: "success",
          data: {
            echo: `the number is ${data.n}`,
          },
        } as TaskResult<MyMockResultType>;
      });

      const mockOnProgress = vi.fn<
        (taskId: string, result: TaskResult<MyMockResultType>) => void
      >((taskId, result) => {
        console.log(
          `task '${taskId}' completed with result: '${JSON.stringify(result)}'`,
        );
      });

      const result = await enqueueTasks<MyMockDataType, MyMockResultType>(
        tasks,
        {
          perform: mockPerformAsync,
          onProgress: mockOnProgress,
        },
        {
          retryCount: 3,
          delayMs: 100,
        },
      );

      expect(result.completed).toEqual([
        {
          id: "one",
          result: {
            data: {
              echo: "the number is 1",
            },
            status: "success",
          },
        },
        {
          id: "three",
          result: {
            data: {
              echo: "the number is 3",
            },
            status: "success",
          },
        },
        {
          id: "four",
          result: {
            data: {
              echo: "the number is 4",
            },
            status: "success",
          },
        },
      ]);
      expect(result.failed).toEqual([
        {
          id: "two",
          result: {
            status: "fail",
            error: "cannot perform two (2)",
          },
        },
      ]);
      // perform function is called
      // Progress is called
      expect(mockOnProgress.mock.calls).toHaveLength(4);
      expect(mockOnProgress.mock.calls[0][0]).toEqual("one");
      expect(mockOnProgress.mock.calls[0][1]).toEqual({
        status: "success",
        data: { echo: "the number is 1" },
      });
      expect(mockOnProgress.mock.calls[1][0]).toEqual("three");
      expect(mockOnProgress.mock.calls[1][1]).toEqual({
        status: "success",
        data: { echo: "the number is 3" },
      });
      expect(mockOnProgress.mock.calls[2][0]).toEqual("four");
      expect(mockOnProgress.mock.calls[2][1]).toEqual({
        status: "success",
        data: { echo: "the number is 4" },
      });
      // failed task
      expect(mockOnProgress.mock.calls[3][0]).toEqual("two");
      expect(mockOnProgress.mock.calls[3][1]).toEqual({
        status: "fail",
        error: "cannot perform two (2)",
      });
      // called 7 times: one, two, three, four, two, two, two
      expect(mockPerformAsync.mock.calls).toHaveLength(7);
      // retries for task 'two'
      expect(mockPerformAsync.mock.calls[4][0]).toEqual({ n: 2 });
      expect(mockPerformAsync.mock.calls[5][0]).toEqual({ n: 2 });
    });
  });

  describe("when no tasks provided", () => {
    it("should return empty results", async () => {
      const tasks: QueueTask<boolean>[] = [];
      const mockPerform = vi.fn().mockResolvedValue({
        status: "success",
        data: { echo: "the number is -1" },
      });
      const onProgress = () => undefined;

      const result = await enqueueTasks<boolean, MyMockResultType>(tasks, {
        perform: mockPerform,
        onProgress: onProgress,
      });

      expect(result).toEqual({
        completed: [],
        failed: [],
      });
    });
  });

  describe("when IDs are not unique", () => {
    it("should throw an error indicating the id's are not unique", async () => {
      const badTasks: QueueTask<boolean>[] = [
        {
          id: "1",
          data: true,
        },
        {
          id: "2",
          data: true,
        },
        {
          id: "1",
          data: true,
        },
      ];
      const mockPerform = vi.fn().mockResolvedValue({
        status: "success",
        data: { echo: "the number is -1" },
      });
      const onProgress = () => undefined;

      await expect(async () => {
        await enqueueTasks<boolean, MyMockResultType>(badTasks, {
          perform: mockPerform,
          onProgress: onProgress,
        });
      }).rejects.toThrow("all task identifiers must be unique: 1, 2, 1");
    });
  });
});
