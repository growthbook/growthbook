import { z, ZodError } from "zod";
import { MakeGenericClass, Context } from "../../src/models/BaseModel";

const BaseModel = MakeGenericClass({
  schema: z.object({ name: z.string(), readonlyField: z.string().optional() }),
  collectionName: "test_model",
  idPrefix: "test_model__",
  // Don't want to extend the type system here.
  auditLog: {
    entity: "metric",
    createEvent: "metric.create",
    updateEvent: "metric.update",
    deleteEvent: "metric.delete",
  },
  readonlyFields: ["readonlyField"],
});

// This one is called in the constructor and therefore needs to be instantiated before that call.
const addIndexesMock = jest.fn();

class TestModel extends BaseModel {
  public constructor(context: Context) {
    super(context);
    this.canReadMock = jest.fn(() => true);
    this.canCreateMock = jest.fn(() => true);
    this.canUpdateMock = jest.fn(() => true);
    this.canDeleteMock = jest.fn(() => true);
    this.dangerousGetCollectionMock = jest.fn();
    this.migrateMock = jest.fn((doc) => doc);
    this.populateForeignRefsMock = jest.fn();
    this.beforeCreateMock = jest.fn();
    this.beforeUpdateMock = jest.fn();
    this.afterCreateMock = jest.fn();
    this.afterCreateOrUpdateMock = jest.fn();
    this.afterUpdateMock = jest.fn();
  }

  protected canRead(doc: z.infer<T>): boolean {
    return this.canReadMock(doc);
  }

  protected canCreate(doc: z.infer<T>): boolean {
    return this.canCreateMock(doc);
  }

  protected canUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>
  ): boolean {
    return this.canUpdateMock(existing, updates, newDoc);
  }

  protected canDelete(existing: z.infer<T>): boolean {
    return this.canDeleteMock(existing);
  }

  private addIndexes() {
    return addIndexesMock();
  }

  private migrate(doc) {
    return this.migrateMock(doc);
  }

  private populateForeignRefs(models) {
    return this.populateForeignRefsMock(models);
  }

  protected _dangerousGetCollection(): Collection {
    return this.dangerousGetCollectionMock();
  }

  protected beforeCreate(doc, options) {
    return this.beforeCreateMock(doc, options);
  }

  protected beforeUpdate(existing, updates, newDoc, options) {
    return this.beforeUpdateMock(existing, updates, newDoc, options);
  }

  protected afterCreate(doc, options) {
    return this.afterCreateMock(doc, options);
  }

  protected afterCreateOrUpdate(doc, options) {
    return this.afterCreateOrUpdateMock(doc, options);
  }

  protected afterUpdate(existing, updates, newDoc, options) {
    return this.afterUpdateMock(existing, updates, newDoc, options);
  }
}

const auditLogMock = jest.fn();

const defaultContext = {
  org: { id: 1 },
  auditLog: auditLogMock,
};

describe("BaseModel", () => {
  it("adds indexes", () => {
    new TestModel(defaultContext);
    expect(addIndexesMock).toHaveBeenCalled();
  });

  it("can find by id", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      _id: "removed",
      __v: "removed",
      id: "aabb",
      name: "foo",
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      findOne: mockFind,
    });

    model.canReadMock.mockReturnValueOnce(true);

    const ret = await model.getById("aabb");
    expect(ret).toEqual({ id: "aabb", name: "foo" });
    expect(model.migrateMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
    expect(mockFind).toHaveBeenCalledWith({ id: "aabb", organization: 1 });
    expect(model.populateForeignRefsMock).toHaveBeenCalledWith([
      { id: "aabb", name: "foo" },
    ]);
    expect(model.canReadMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
  });

  it("filters find by id when read permission is denied", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      _id: "removed",
      __v: "removed",
      id: "aabb",
      name: "foo",
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      findOne: mockFind,
    });

    model.canReadMock.mockReturnValueOnce(false);

    const ret = await model.getById("aabb");
    expect(ret).toEqual(null);
  });

  it("can getAll", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      toArray: () => [
        {
          _id: "removed",
          __v: "removed",
          id: "aabb",
          name: "foo",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ccdd",
          name: "bla",
        },
      ],
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      find: mockFind,
    });

    model.canReadMock.mockReturnValue(true);

    const ret = await model.getAll();
    expect(model.migrateMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
    expect(mockFind).toHaveBeenCalledWith({ organization: 1 });
    expect(model.populateForeignRefsMock).toHaveBeenCalledWith([
      { id: "aabb", name: "foo" },
      { id: "ccdd", name: "bla" },
    ]);
    expect(model.canReadMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
    expect(model.canReadMock).toHaveBeenCalledWith({ id: "ccdd", name: "bla" });
    expect(ret).toEqual([
      { id: "aabb", name: "foo" },
      { id: "ccdd", name: "bla" },
    ]);
  });

  it("can filter getAll result by read permission", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      toArray: () => [
        {
          _id: "removed",
          __v: "removed",
          id: "aabb",
          name: "foo",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ccdd",
          name: "bla",
        },
      ],
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      find: mockFind,
    });

    model.canReadMock.mockImplementation(({ id }) => id === "aabb");

    const ret = await model.getAll();
    expect(ret).toEqual([{ id: "aabb", name: "foo" }]);
  });

  it("can bypass read permission in _find results", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      toArray: () => [
        {
          _id: "removed",
          __v: "removed",
          id: "aabb",
          name: "foo",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ccdd",
          name: "bla",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "eeff",
          name: "eeff",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "gghh",
          name: "gghh",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ffee",
          name: "ffee",
        },
      ],
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      find: mockFind,
    });

    model.canReadMock.mockImplementation(({ id }) => id !== "eeff");

    const ret = await model._find({}, { bypassReadPermissionChecks: true });
    expect(ret).toEqual([
      {
        id: "aabb",
        name: "foo",
      },
      {
        id: "ccdd",
        name: "bla",
      },
      {
        id: "eeff",
        name: "eeff",
      },
      {
        id: "gghh",
        name: "gghh",
      },
      {
        id: "ffee",
        name: "ffee",
      },
    ]);
  });

  it("can paginate _find results", async () => {
    const model = new TestModel(defaultContext);

    const mockFind = jest.fn();
    mockFind.mockReturnValueOnce({
      toArray: () => [
        {
          _id: "removed",
          __v: "removed",
          id: "aabb",
          name: "foo",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ccdd",
          name: "bla",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "eeff",
          name: "eeff",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "gghh",
          name: "gghh",
        },
        {
          _id: "removed",
          __v: "removed",
          id: "ffee",
          name: "ffee",
        },
      ],
    });

    model.dangerousGetCollectionMock.mockReturnValueOnce({
      find: mockFind,
    });

    model.canReadMock.mockImplementation(({ id }) => id !== "eeff");

    const ret = await model._find({}, { skip: 2, limit: 4 });
    expect(ret).toEqual([
      {
        id: "gghh",
        name: "gghh",
      },
      {
        id: "ffee",
        name: "ffee",
      },
    ]);
  });

  it("raises an error when attempting to create without create access", () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(false);
    expect(model.create({ name: "foo", id: "aabb" })).rejects.toEqual(
      new Error("You do not have access to create this resource")
    );
  });

  it("raises an error when attempting to create an invalid document", () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(true);
    expect(model.create({ id: "aabb" })).rejects.toEqual(
      new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["name"],
          message: "Required",
        },
      ])
    );
  });

  it("allows creation of a document with a readonly field", async () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(true);

    const insertOneMock = jest.fn();
    model.dangerousGetCollectionMock.mockReturnValue({
      insertOne: insertOneMock,
    });

    await model.create(
      { name: "foo", id: "aabb", readonlyField: "bla" },
      "options"
    );

    const expectedModel = expect.objectContaining({
      dateCreated: expect.any(Date),
      dateUpdated: expect.any(Date),
      id: expect.any(String),
      name: "foo",
      organization: 1,
      readonlyField: "bla",
    });

    expect(insertOneMock).toHaveBeenCalledWith(expectedModel);
    expect(model.afterCreateMock).toHaveBeenCalledWith(
      expectedModel,
      "options"
    );
    expect(auditLogMock).toHaveBeenCalled();
    expect(model.afterCreateMock).toHaveBeenCalledWith(
      expectedModel,
      "options"
    );
    expect(model.afterCreateMock).toHaveBeenCalledWith(
      expectedModel,
      "options"
    );
  });

  it("raises an error when attempting to update a document without update access", () => {
    const model = new TestModel(defaultContext);
    model.canUpdateMock.mockReturnValue(false);
    expect(
      model.update({ name: "foo", id: "aabb" }, { name: "gni" })
    ).rejects.toEqual(
      new Error("You do not have access to update this resource")
    );
  });

  it("raises an error when attempting to update a read-only field", () => {
    const model = new TestModel(defaultContext);
    model.canUpdateMock.mockReturnValue(true);
    expect(
      model.update({ name: "foo", id: "aabb" }, { readonlyField: "gni" })
    ).rejects.toEqual(
      new Error("Cannot update readonly fields: readonlyField")
    );
  });

  it("allows uppating a document", async () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(true);

    const updateOneMock = jest.fn();
    model.dangerousGetCollectionMock.mockReturnValue({
      updateOne: updateOneMock,
    });

    await model.update(
      { name: "foo", id: "aabb", readonlyField: "bla" },
      { name: "gni" },
      "options"
    );

    const expectedSet = expect.objectContaining({
      dateUpdated: expect.any(Date),
      name: "gni",
    });

    expect(updateOneMock).toHaveBeenCalledWith(
      { id: "aabb", organization: 1 },
      { $set: expectedSet }
    );
    expect(auditLogMock).toHaveBeenCalled();
    expect(model.beforeUpdateMock).toHaveBeenCalledWith(
      { id: "aabb", name: "foo", readonlyField: "bla" },
      { name: "gni" },
      expectedSet,
      "options"
    );
    expect(model.afterUpdateMock).toHaveBeenCalledWith(
      { id: "aabb", name: "foo", readonlyField: "bla" },
      { name: "gni" },
      expectedSet,
      "options"
    );
    expect(model.afterCreateOrUpdateMock).toHaveBeenCalledWith(
      expectedSet,
      "options"
    );
  });

  it("raises an error when attempting to delete a document without delete access", () => {
    const model = new TestModel(defaultContext);
    model.canDeleteMock.mockReturnValue(false);
    expect(model.delete({ name: "foo", id: "aabb" })).rejects.toEqual(
      new Error("You do not have access to delete this resource")
    );
  });
});
