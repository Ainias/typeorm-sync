import { FindManyOptions, IsNull, MoreThan, Not } from 'typeorm';
import { Database } from '../Database';
import { ModelContainer, SyncHelper } from '../Sync/SyncHelper';
import { JsonHelper } from 'js-helper';

export async function queryFromClient(
    entityId: number,
    lastQueryDate: Date | undefined,
    queryOptions: FindManyOptions
) {
    queryOptions.where = queryOptions.where ?? {};
    const deleteOptions = JsonHelper.deepCopy(queryOptions);

    if (lastQueryDate) {
        if (Array.isArray(queryOptions.where)) {
            queryOptions.where.forEach((orCondition) => (orCondition.updatedAt = MoreThan(lastQueryDate)));
            deleteOptions.where.forEach((orCondition) => (orCondition.deletedAt = MoreThan(lastQueryDate)));
        } else {
            queryOptions.where.updatedAt = MoreThan(lastQueryDate);
            deleteOptions.where.deletedAt = MoreThan(lastQueryDate);
        }
    } else {
        deleteOptions.where.deletedAt = Not(IsNull());
    }
    deleteOptions.withDeleted = true;
    deleteOptions.select = ['id'];

    const Entity = Database.getInstance().getEntityForId(entityId);
    const newLastQueryDate = new Date();
    const modelsPromise = Entity.find(queryOptions);
    const deletedPromise = Entity.find(deleteOptions);

    const models = await modelsPromise;
    const modelContainer: ModelContainer = {};
    models.forEach((model) => {
        SyncHelper.addToModelContainer(model, modelContainer);
    });
    const deleted = (await deletedPromise).map((m) => m.id);

    return {
        lastQueryDate: newLastQueryDate,
        deleted,
        syncContainer: SyncHelper.convertToSyncContainer(modelContainer),
    };
}