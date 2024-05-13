import { z } from "zod";
import { MakeGenericClass } from "../../src/models/BaseModel";

describe("BaseModel", () => {
  const canReadMock = jest.fn();
  const canCreateMock = jest.fn();
  const canUpdateMock = jest.fn();
  const canDeleteMock = jest.fn();
  const dangerousGetCollectionMock = jest.fn();
  const addIndexesMock = jest.fn();
  const migrateMock = jest.fn((doc) => doc);
  const populateForeignRefsMock = jest.fn();

  const BaseModel = MakeGenericClass({
    schema: z.object({ name: z.string() }),
    collectionName: "test_model",
    idPrefix: "test_model__",
    // Don't want to extend the type system here.
    auditLog: {
      entity: "metric",
      createEvent: "metric.create",
      updateEvent: "metric.update",
      deleteEvent: "metric.delete",
    },
  });

  class TestModel extends BaseModel {
    protected canRead(doc: z.infer<T>): boolean {
      return canReadMock(doc);
    }

    protected canCreate(doc: z.infer<T>): boolean {
      return canCreateMock(doc);
    }

    protected canUpdate(
      existing: z.infer<T>,
      updates: UpdateProps<z.infer<T>>,
      newDoc: z.infer<T>
    ): boolean {
      return canUpdateMock(existing, updates, newDoc);
    }

    protected canDelete(existing: z.infer<T>): boolean {
      return canDeleteMock(existing);
    }

    private addIndexes() {
      return addIndexesMock();
    }

    private migrate(doc) {
      return migrateMock(doc);
    }

    private populateForeignRefs(models) {
      return populateForeignRefsMock(models);
    }

    protected _dangerousGetCollection(): Collection {
      return dangerousGetCollectionMock();
    }
  }

  const defaultContext = {
    org: { id: 1 },
  };

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

    dangerousGetCollectionMock.mockReturnValueOnce({
      findOne: mockFind,
    });

    canReadMock.mockReturnValueOnce(true);

    const ret = await model.getById("aabb");
    expect(ret).toEqual({ id: "aabb", name: "foo" });
    expect(migrateMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
    expect(mockFind).toHaveBeenCalledWith({ id: "aabb", organization: 1 });
    expect(populateForeignRefsMock).toHaveBeenCalledWith([
      { id: "aabb", name: "foo" },
    ]);
    expect(canReadMock).toHaveBeenCalledWith({ id: "aabb", name: "foo" });
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

    dangerousGetCollectionMock.mockReturnValueOnce({
      findOne: mockFind,
    });

    canReadMock.mockReturnValueOnce(false);

    const ret = await model.getById("aabb");
    expect(ret).toEqual(null);
  });
});
