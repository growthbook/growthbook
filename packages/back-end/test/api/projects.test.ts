import request from "supertest";
import { setupApp } from "./api.setup";

describe("environements API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("can list all projects", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [
            {
              id: "proj1",
              description: "proj1",
            },
            {
              id: "proj2",
              description: "proj2",
            },
          ],
          toApiInterface: ({ id }) => `${id}_interface`,
        },
      },
    });

    const response = await request(app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      count: 2,
      hasMore: false,
      limit: 10,
      nextOffset: null,
      offset: 0,
      total: 2,
      projects: ["proj1_interface", "proj2_interface"],
    });
  });

  it("can paginate projects", async () => {
    setReqContext({
      models: {
        projects: {
          getAll: () => [
            {
              id: "proj1",
              description: "proj1",
            },
            {
              id: "proj2",
              description: "proj2",
            },
            {
              id: "proj3",
              description: "proj3",
            },
          ],
          toApiInterface: ({ id }) => `${id}_interface`,
        },
      },
    });

    const response = await request(app)
      .get("/api/v1/projects?offset=1&limit=1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      count: 1,
      hasMore: true,
      limit: 1,
      nextOffset: 2,
      offset: 1,
      total: 3,
      projects: ["proj2_interface"],
    });
  });

  it("can delete projects", async () => {
    const deleteByIdMock = jest.fn();
    setReqContext({
      models: {
        projects: {
          deleteById: deleteByIdMock,
        },
      },
    });

    deleteByIdMock.mockReturnValue({ id: "prj__1", name: "le proj 1" });

    const response = await request(app)
      .delete("/api/v1/projects/prj__1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deletedId: "prj__1" });
    expect(deleteByIdMock).toHaveBeenCalledWith("prj__1");
    expect(auditMock).toHaveBeenCalledWith({
      details: '{"pre":{"id":"prj__1","name":"le proj 1"},"context":{}}',
      entity: { id: "prj__1", object: "project" },
      event: "project.delete",
    });
  });

  it("throws and error when deleting non-existing projects", async () => {
    const deleteByIdMock = jest.fn();
    setReqContext({
      models: {
        projects: {
          deleteById: deleteByIdMock,
        },
      },
    });

    deleteByIdMock.mockReturnValue(undefined);

    const response = await request(app)
      .delete("/api/v1/projects/prj__1")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Could not find project!" });
  });

  it("can update projects", async () => {
    const getByIdMock = jest.fn();
    const updateMock = jest.fn();
    const updateValidatorMock = jest.fn();
    const toApiInterfaceMock = jest.fn();

    setReqContext({
      models: {
        projects: {
          getById: getByIdMock,
          update: updateMock,
          updateValidator: { parse: updateValidatorMock },
          toApiInterface: toApiInterfaceMock,
        },
      },
    });

    getByIdMock.mockReturnValue({ id: "prj__3", description: "le proj 3" });
    updateMock.mockImplementation((existing, updated) => ({
      ...existing,
      ...updated,
    }));
    updateValidatorMock.mockImplementation((v) => v);
    toApiInterfaceMock.mockImplementation((v) => ({
      ...v,
      id: `${v.id}__interface`,
    }));

    const response = await request(app)
      .put("/api/v1/projects/prj__3")
      .send({
        description: "new description",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      project: {
        id: "prj__3__interface",
        description: "new description",
      },
    });
    expect(getByIdMock).toHaveBeenCalledWith("prj__3");
    expect(updateMock).toHaveBeenCalledWith(
      { id: "prj__3", description: "le proj 3" },
      { description: "new description" },
    );
    expect(updateValidatorMock).toHaveBeenCalledWith({
      description: "new description",
    });
    expect(toApiInterfaceMock).toHaveBeenCalledWith({
      id: "prj__3",
      description: "new description",
    });
    expect(auditMock).toHaveBeenCalledWith({
      details:
        '{"pre":{"id":"prj__3","description":"le proj 3"},"post":{"id":"prj__3","description":"new description"},"context":{}}',
      entity: { id: "prj__3", object: "project" },
      event: "project.update",
    });
  });

  it("refuses to update projects when they do not exist", async () => {
    setReqContext({
      models: {
        projects: {
          getById: () => undefined,
        },
      },
    });

    const response = await request(app)
      .put("/api/v1/projects/prj__3")
      .send({
        description: "new description",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Could not find project with that id",
    });
  });

  it("validates update payload", async () => {
    const response = await request(app)
      .put("/api/v1/projects/prj__3")
      .send({
        description: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [description] Invalid input: expected string, received boolean",
    });
  });

  it("can create projects", async () => {
    const createMock = jest.fn();
    const createValidatorMock = jest.fn();
    const toApiInterfaceMock = jest.fn();

    setReqContext({
      models: {
        projects: {
          create: createMock,
          createValidator: { parse: createValidatorMock },
          toApiInterface: toApiInterfaceMock,
        },
      },
    });

    createMock.mockImplementation((v) => ({ ...v, id: "prj__3" }));
    createValidatorMock.mockImplementation((v) => v);
    toApiInterfaceMock.mockImplementation((v) => ({
      ...v,
      id: `${v.id}__interface`,
    }));

    const response = await request(app)
      .post("/api/v1/projects")
      .send({
        name: "le proj trois",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      project: {
        id: "prj__3__interface",
        name: "le proj trois",
      },
    });
    expect(createMock).toHaveBeenCalledWith({
      name: "le proj trois",
    });
    expect(createValidatorMock).toHaveBeenCalledWith({
      name: "le proj trois",
    });
    expect(toApiInterfaceMock).toHaveBeenCalledWith({
      id: "prj__3",
      name: "le proj trois",
    });
    expect(auditMock).toHaveBeenCalledWith({
      details: '{"post":{"name":"le proj trois","id":"prj__3"},"context":{}}',
      entity: { id: "prj__3", object: "project" },
      event: "project.create",
    });
  });

  it("validates create payload", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .send({
        name: false,
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message:
        "Request body: [name] Invalid input: expected string, received boolean",
    });
  });
});
