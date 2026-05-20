import { z } from "zod";
import { Collection } from "mongodb";
import { Context, MakeModelClass } from "../../src/models/BaseModel";

type WriteOptions = {
  option?: boolean;
};

const BaseModel = MakeModelClass({
  schema: z
    .object({
      id: z.string(),
      uid: z.string(),
      organization: z.string(),
      dateCreated: z.date(),
      dateUpdated: z.date(),
      name: z.string(),
      readonlyField: z.string().optional(),
      testDefaultField: z.string().optional(),
    })
    .strict(),
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
  indexesToRemove: ["my_old_index"],
});

// This one is called in the constructor and therefore needs to be instantiated before that call.
const updateIndexesMock = jest.fn();

class TestModel extends BaseModel<WriteOptions> {
  public canReadMock: jest.Mock;
  public canCreateMock: jest.Mock;
  public canUpdateMock: jest.Mock;
  public canDeleteMock: jest.Mock;
  public dangerousGetCollectionMock: jest.Mock;
  public migrateMock: jest.Mock;
  public populateForeignRefsMock: jest.Mock;
  public beforeCreateMock: jest.Mock;
  public beforeUpdateMock: jest.Mock;
  public afterCreateMock: jest.Mock;
  public afterCreateOrUpdateMock: jest.Mock;
  public afterUpdateMock: jest.Mock;

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

  public find(...args) {
    return this._find(...args);
  }

  public applyDefaultValues(
    props: Record<string, unknown>,
    defaults: Record<string, unknown>,
  ): void {
    return this._applyDefaultValues(props, defaults);
  }

  protected canRead(...args): boolean {
    return this.canReadMock(...args);
  }

  protected canCreate(...args): boolean {
    return this.canCreateMock(...args);
  }

  protected canUpdate(...args): boolean {
    return this.canUpdateMock(...args);
  }

  protected canDelete(...args): boolean {
    return this.canDeleteMock(...args);
  }

  protected updateIndexes(...args) {
    return updateIndexesMock(...args);
  }

  protected migrate(...args) {
    return this.migrateMock(...args);
  }

  protected populateForeignRefs(...args) {
    return this.populateForeignRefsMock(...args);
  }

  protected _dangerousGetCollection(...args): Collection {
    return this.dangerousGetCollectionMock(...args);
  }

  protected beforeCreate(...args) {
    return this.beforeCreateMock(...args);
  }

  protected beforeUpdate(...args) {
    return this.beforeUpdateMock(...args);
  }

  protected afterCreate(...args) {
    return this.afterCreateMock(...args);
  }

  protected afterCreateOrUpdate(...args) {
    return this.afterCreateOrUpdateMock(...args);
  }

  protected afterUpdate(...args) {
    return this.afterUpdateMock(...args);
  }

  public exposeGetEntityId(doc: Record<string, unknown>): string {
    return this.getEntityId(doc);
  }
}

const CompositeBaseModel = MakeModelClass({
  schema: z
    .object({
      userId: z.string(),
      organization: z.string(),
      dateCreated: z.date(),
      dateUpdated: z.date(),
      name: z.string(),
    })
    .strict(),
  collectionName: "composite_test",
  pKey: ["userId", "organization"],
  auditLog: {
    entity: "metric",
    createEvent: "metric.create",
    updateEvent: "metric.update",
    deleteEvent: "metric.delete",
  },
});

class CompositeTestModel extends CompositeBaseModel {
  public canReadMock: jest.Mock;
  public canCreateMock: jest.Mock;
  public canUpdateMock: jest.Mock;
  public canDeleteMock: jest.Mock;
  public dangerousGetCollectionMock: jest.Mock;
  public migrateMock: jest.Mock;
  public populateForeignRefsMock: jest.Mock;

  public constructor(context: Context) {
    super(context);
    this.canReadMock = jest.fn(() => true);
    this.canCreateMock = jest.fn(() => true);
    this.canUpdateMock = jest.fn(() => true);
    this.canDeleteMock = jest.fn(() => true);
    this.dangerousGetCollectionMock = jest.fn();
    this.migrateMock = jest.fn((doc) => doc);
    this.populateForeignRefsMock = jest.fn();
  }

  public exposeGetEntityId(doc: Record<string, unknown>): string {
    return this.getEntityId(doc);
  }

  protected canRead(...args): boolean {
    return this.canReadMock(...args);
  }

  protected canCreate(...args): boolean {
    return this.canCreateMock(...args);
  }

  protected canUpdate(...args): boolean {
    return this.canUpdateMock(...args);
  }

  protected canDelete(...args): boolean {
    return this.canDeleteMock(...args);
  }

  protected updateIndexes(...args) {
    updateIndexesMock(...args);
  }

  protected migrate(...args) {
    return this.migrateMock(...args);
  }

  protected populateForeignRefs(...args) {
    return this.populateForeignRefsMock(...args);
  }

  protected _dangerousGetCollection(...args): Collection {
    return this.dangerousGetCollectionMock(...args);
  }
}

const auditLogMock = jest.fn();

const defaultContext = {
  org: { id: "a" },
  auditLog: auditLogMock,
} as unknown as Context;

describe("BaseModel", () => {
  it("adds indexes", () => {
    new TestModel(defaultContext);
    expect(updateIndexesMock).toHaveBeenCalled();
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
    expect(mockFind).toHaveBeenCalledWith({ id: "aabb", organization: "a" });
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
    expect(mockFind).toHaveBeenCalledWith({ organization: "a" });
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

    const ret = await model.find({}, { bypassReadPermissionChecks: true });
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

    const ret = await model.find({}, { skip: 2, limit: 4 });
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
      new Error("You do not have access to create this resource"),
    );
  });

  it("raises an error when attempting to create an invalid document", () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(true);
    expect(model.create({ id: "aabb" })).rejects.toMatchObject({
      issues: [
        {
          expected: "string",
          code: "invalid_type",
          path: ["name"],
          message: "Invalid input: expected string, received undefined",
        },
      ],
    });
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
      { option: true },
    );

    const expectedModel = expect.objectContaining({
      dateCreated: expect.any(Date),
      dateUpdated: expect.any(Date),
      id: expect.any(String),
      name: "foo",
      organization: "a",
      readonlyField: "bla",
    });

    expect(insertOneMock).toHaveBeenCalledWith(expectedModel);
    expect(model.afterCreateMock).toHaveBeenCalledWith(expectedModel, {
      option: true,
    });
    expect(auditLogMock).toHaveBeenCalled();
    expect(model.afterCreateMock).toHaveBeenCalledWith(expectedModel, {
      option: true,
    });
    expect(model.afterCreateMock).toHaveBeenCalledWith(expectedModel, {
      option: true,
    });
  });

  describe("_applyDefaultValues", () => {
    it("applies default values when properties are undefined", () => {
      const model = new TestModel(defaultContext);
      const props = { name: "test" };
      const defaults = { testDefaultField: "default", otherField: "other" };

      model.applyDefaultValues(props, defaults);

      expect(props).toEqual({
        name: "test",
        testDefaultField: "default",
        otherField: "other",
      });
    });

    it("does not overwrite existing values", () => {
      const model = new TestModel(defaultContext);
      const props = { name: "test", testDefaultField: "existing" };
      const defaults = { testDefaultField: "default" };

      model.applyDefaultValues(props, defaults);

      expect(props.testDefaultField).toBe("existing");
    });

    it("merges nested objects recursively", () => {
      const model = new TestModel(defaultContext);
      const props = {
        name: "test",
        nested: {
          existing: "value",
        },
      };
      const defaults = {
        testDefaultField: "default",
        nested: {
          newField: "newValue",
          existing: "shouldNotOverwrite",
        },
      };

      model.applyDefaultValues(props, defaults);

      expect(props).toEqual({
        name: "test",
        testDefaultField: "default",
        nested: {
          existing: "value",
          newField: "newValue",
        },
      });
    });

    it("applies defaults to undefined nested objects", () => {
      const model = new TestModel(defaultContext);
      const props = { name: "test" };
      const defaults = {
        nested: {
          field1: "value1",
          field2: "value2",
        },
      };

      model.applyDefaultValues(props, defaults);

      expect(props).toEqual({
        name: "test",
        nested: {
          field1: "value1",
          field2: "value2",
        },
      });
    });

    it("does not merge arrays", () => {
      const model = new TestModel(defaultContext);
      const props = { name: "test", tags: ["existing"] };
      const defaults = { tags: ["default1", "default2"] };

      model.applyDefaultValues(props, defaults);

      // Arrays should not be merged - existing array is preserved
      expect(props.tags).toEqual(["existing"]);
    });

    it("handles null values correctly", () => {
      const model = new TestModel(defaultContext);
      const props: Record<string, unknown> = { name: "test", nullable: null };
      const defaults = { nullable: "default", other: null };

      model.applyDefaultValues(props, defaults);

      // null is not undefined, so it should not be overwritten
      expect(props.nullable).toBe(null);
      // null in defaults should be applied if value is undefined
      expect(props.other).toBe(null);
    });

    it("handles deeply nested objects", () => {
      const model = new TestModel(defaultContext);
      const props = {
        level1: {
          level2: {
            existing: "value",
          },
        },
      };
      const defaults = {
        level1: {
          level2: {
            newField: "newValue",
          },
          otherField: "other",
        },
      };

      model.applyDefaultValues(props, defaults);

      expect(props).toEqual({
        level1: {
          level2: {
            existing: "value",
            newField: "newValue",
          },
          otherField: "other",
        },
      });
    });
  });

  it("raises an error when attempting to update a document without update access", () => {
    const model = new TestModel(defaultContext);
    model.canUpdateMock.mockReturnValue(false);
    expect(
      model.update(
        {
          name: "foo",
          id: "aabb",
          organization: "a",
          dateCreated: new Date(),
          dateUpdated: new Date(),
        },
        { name: "gni" },
      ),
    ).rejects.toEqual(
      new Error("You do not have access to update this resource"),
    );
  });

  it("raises an error when attempting to update a read-only field", () => {
    const model = new TestModel(defaultContext);
    model.canUpdateMock.mockReturnValue(true);
    expect(
      model.update(
        {
          name: "foo",
          id: "aabb",
          organization: "a",
          dateCreated: new Date(),
          dateUpdated: new Date(),
        },
        { readonlyField: "gni" },
      ),
    ).rejects.toEqual(
      new Error("Cannot update readonly fields: readonlyField"),
    );
  });

  it("allows updating a document", async () => {
    const model = new TestModel(defaultContext);
    model.canCreateMock.mockReturnValue(true);

    const updateOneMock = jest.fn();
    model.dangerousGetCollectionMock.mockReturnValue({
      updateOne: updateOneMock,
    });

    const existing = {
      name: "foo",
      id: "aabb",
      readonlyField: "bla",
      organization: "a",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    await model.update(existing, { name: "gni" }, { option: true });

    const expectedSet = expect.objectContaining({
      dateUpdated: expect.any(Date),
      name: "gni",
    });

    expect(updateOneMock).toHaveBeenCalledWith(
      { id: "aabb", organization: "a" },
      { $set: expectedSet },
    );
    expect(auditLogMock).toHaveBeenCalled();
    expect(model.beforeUpdateMock).toHaveBeenCalledWith(
      existing,
      { name: "gni" },
      expectedSet,
      { option: true },
    );
    expect(model.afterUpdateMock).toHaveBeenCalledWith(
      existing,
      { name: "gni" },
      expectedSet,
      { option: true },
    );
    expect(model.afterCreateOrUpdateMock).toHaveBeenCalledWith(expectedSet, {
      option: true,
    });
  });

  it("raises an error when attempting to delete a document without delete access", () => {
    const model = new TestModel(defaultContext);
    model.canDeleteMock.mockReturnValue(false);
    expect(
      model.delete({
        name: "foo",
        id: "aabb",
        organization: "a",
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }),
    ).rejects.toEqual(
      new Error("You do not have access to delete this resource"),
    );
  });

  it("raises an error when attempting to update uid", () => {
    const model = new TestModel(defaultContext);
    expect(
      model.update(
        {
          name: "foo",
          id: "aabb",
          uid: "ccdd",
          organization: "a",
          dateCreated: new Date(),
          dateUpdated: new Date(),
        },
        { uid: "new-uid" },
      ),
    ).rejects.toThrow();
  });

  describe("composite primary key", () => {
    const idMethods: [string, (m: CompositeTestModel) => Promise<unknown>][] = [
      ["getById", async (m) => m.getById("u1")],
      ["getByIds", async (m) => m.getByIds(["u1"])],
      ["updateById", (m) => m.updateById("u1", { name: "x" })],
      ["deleteById", (m) => m.deleteById("u1")],
      [
        "dangerousUpdateByIdBypassPermission",
        (m) => m.dangerousUpdateByIdBypassPermission("u1", { name: "x" }),
      ],
    ];

    it.each(idMethods)(
      "%s throws on a model without an id field",
      async (_, action) => {
        const model = new CompositeTestModel(defaultContext);
        await expect(action(model)).rejects.toThrow(/"id" field/);
      },
    );

    it("uses the composite key in the update filter", async () => {
      const model = new CompositeTestModel(defaultContext);
      const updateOneMock = jest.fn();
      model.dangerousGetCollectionMock.mockReturnValue({
        updateOne: updateOneMock,
      });

      const existing = {
        userId: "u1",
        organization: "a",
        name: "old",
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      await model.update(existing, { name: "new" });

      expect(updateOneMock).toHaveBeenCalledWith(
        { userId: "u1", organization: "a" },
        { $set: expect.objectContaining({ name: "new" }) },
      );
    });

    it("uses the composite key in the delete filter", async () => {
      const model = new CompositeTestModel(defaultContext);
      const deleteOneMock = jest.fn();
      model.dangerousGetCollectionMock.mockReturnValue({
        deleteOne: deleteOneMock,
      });

      const doc = {
        userId: "u1",
        organization: "a",
        name: "test",
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };

      await model.delete(doc);

      expect(deleteOneMock).toHaveBeenCalledWith({
        userId: "u1",
        organization: "a",
      });
    });

    it("does not auto-generate an id when the schema has no id field", async () => {
      const model = new CompositeTestModel(defaultContext);
      const insertOneMock = jest.fn();
      model.dangerousGetCollectionMock.mockReturnValue({
        insertOne: insertOneMock,
      });

      await model.create({ userId: "u1", name: "test" });

      const insertedDoc = insertOneMock.mock.calls[0][0];
      expect(insertedDoc).not.toHaveProperty("id");
      expect(insertedDoc).toMatchObject({
        userId: "u1",
        name: "test",
        organization: "a",
        dateCreated: expect.any(Date),
        dateUpdated: expect.any(Date),
      });
    });

    describe("getEntityId", () => {
      it("serializes a single-field primary key as a bare string", () => {
        const model = new TestModel(defaultContext);
        expect(
          model.exposeGetEntityId({
            id: "abc123",
            organization: "a",
            name: "test",
            dateCreated: new Date(),
            dateUpdated: new Date(),
          }),
        ).toBe("abc123");
      });

      it("serializes a composite primary key as a JSON object string", () => {
        const model = new CompositeTestModel(defaultContext);
        expect(
          model.exposeGetEntityId({
            userId: "u1",
            organization: "a",
            name: "test",
            dateCreated: new Date(),
            dateUpdated: new Date(),
          }),
        ).toBe('{"userId":"u1","organization":"a"}');
      });
    });
  });
});
