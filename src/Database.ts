import {DataSource, DataSourceOptions, FindManyOptions} from 'typeorm';
import type {SyncModel} from './SyncModel';
import {JSONValue, PromiseWithHandlers} from 'js-helper';
import {PersistError} from './Errors/PersistError';
import type {SyncResult} from './Errors/SyncResult';
import {LastQueryDate} from './LastSyncDate/LastQueryDate';
import {QueryError} from './Errors/QueryError';
import {SyncContainer} from "./Sync/SyncTypes";
import type {SyncRepository} from "./Repository/SyncRepository";


export type DatabaseOptions = DataSourceOptions & (
    | {
    isClient?: false;
}
    | {
    isClient: true;
    persist: string | typeof Database.prototype.persistToServer;
    query: string | typeof Database.prototype.queryServer;
    remove: string | typeof Database.prototype.removeFromServer;
    fetchOptions?: RequestInit;
}
    );

export class Database {
    private static instance?: Database;
    private static instancePromise = new PromiseWithHandlers<Database>();
    private static decoratorHandlers: (() => void)[] = [];
    private static syncModels: typeof SyncModel[] = [];

    static addDecoratorHandler(handler: () => void) {
        this.decoratorHandlers.push(handler);
    }

    static async init(options: DatabaseOptions) {
        if (!this.instance) {
            this.instance = new Database(options);
            await this.instance.connect();
        }
        return this.instance;
    }

    static async destroy() {
        if (this.instance) {
            const {instance} = this;
            this.instance = undefined;
            this.instancePromise = new PromiseWithHandlers<Database>();
            await (await instance.getConnectionPromise()).destroy();
        }
    }

    static getInstance() {
        return this.instance;
    }

    static waitForInstance() {
        return this.instancePromise;
    }

    static setSyncModels(syncModels: typeof SyncModel[]){
        this.syncModels = syncModels;
    }

    static getModelIdFor(model: typeof SyncModel|SyncModel) {
        if (!('prototype' in model)) {
            model = model.constructor as typeof SyncModel;
        }
        return this.syncModels.findIndex((val) => val === model);
    }

    static getModelForId(modelId: number) {
        return this.syncModels[modelId];
    }

    private options: DatabaseOptions;
    private source?: DataSource;
    private connectionPromise: PromiseWithHandlers<DataSource> = new PromiseWithHandlers<DataSource>();
    private connectionTry = 0;
    private repositories: Record<any, Promise<SyncRepository<any>>> = {};

    private constructor(options: DatabaseOptions) {
        this.options = {entities: [], ...options};
    }

    async reconnect(options: DatabaseOptions) {
        this.options = {entities: [], ...options};
        if (this.source) {
            this.source.destroy();
            this.source = undefined;
            this.connectionPromise = new PromiseWithHandlers<DataSource>();
        }
        this.repositories = {};
        this.connect();
        return this;
    }

    private async connect() {
        this.connectionTry++;
        const currentTry = this.connectionTry;
        const entities = Object.values(this.options.entities);
        entities.push(...Database.syncModels);

        if (this.isClientDatabase() && entities.indexOf(LastQueryDate) === -1) {
            entities.push(LastQueryDate);
        }
        this.options = {...this.options, entities};
        Database.decoratorHandlers.forEach(handler => handler());

        const source = new DataSource(this.options);
        await source.initialize().catch(e => console.log("Initialization Error", e));
        if (currentTry !== this.connectionTry) {
            await source.destroy();
            return;
        }

        this.source = source;
        this.connectionPromise.resolve(this.source);
        Database.instancePromise.resolve(this);

        if (this.isClientDatabase() && typeof window !== "undefined") {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            window.queryDB = async (sql: string) => {
                const res = await this.source.query(sql);
                console.log(res);
                return res;
            };
        }
    }

    private static entitiesChanged(prevEntities: any[], newEntities: any[]) {
        if (prevEntities.length !== newEntities.length) {
            return true;
        }
        return prevEntities.some((prev, index) => prev !== newEntities[index]);
    }

    getConnectionPromise(): Promise<DataSource> {
        return this.connectionPromise.then(connection => {
            if (Database.entitiesChanged(connection.options.entities as any[], this.options.entities as any[])) {
                return this.reconnect(this.options).then(() => this.getConnectionPromise());
            }
            return connection;
        });
    }

    isClientDatabase() {
        return this.options.isClient === true;
    }

    isServerDatabase() {
        return !this.isClientDatabase();
    }

    async persistToServer(
        modelId: number,
        entityId: number,
        syncContainer: SyncContainer,
        extraData?: JSONValue
    ): Promise<SyncResult<PersistError>> {
        const {isClient} = this.options;

        if (isClient) {
            const {persist, fetchOptions} = this.options;
            if (typeof persist === 'string') {
                return fetch(persist, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({modelId, entityId, syncContainer, extraData}),
                    ...fetchOptions,
                }).then((res) => res.json());
            }
            return persist(modelId, entityId, syncContainer, extraData);
        }
        return {success: false, error: {message: 'Database is not a client database!'}};
    }

    async queryServer(
        modelId: number,
        lastQueryDate: Date | undefined,
        queryOptions: FindManyOptions,
        extraData?: JSONValue
    ): Promise<SyncResult<QueryError>> {
        const {isClient} = this.options;

        if (isClient) {
            const {query, fetchOptions} = this.options;
            if (typeof query === 'string') {
                return fetch(query, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({modelId, lastQueryDate, queryOptions, extraData}),
                    ...fetchOptions,
                }).then((res) => res.json()).catch(e => console.error("LOG error:", e));
            }
            return query(modelId, lastQueryDate, queryOptions, extraData);
        }
        return {success: false, error: {message: 'Database is not a client database!'}};
    }

    async removeFromServer(modelId: number, entityId: number, extraData?: JSONValue) {
        const {isClient} = this.options;

        if (isClient) {
            const {remove, fetchOptions} = this.options;
            if (typeof remove === 'string') {
                return fetch(remove, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({modelId, entityId, extraData}),
                    ...fetchOptions,
                }).then((res) => res.json());
            }
            return remove(modelId, entityId, extraData);
        }
        return {success: false, error: {message: 'Database is not a client database!'}};
    }

    setRepositoryPromise(model: typeof SyncModel, repositoryPromise: Promise<SyncRepository<any>>) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.repositories[model] = repositoryPromise;
    }

    getRepositoryPromise(model: typeof SyncModel) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return this.repositories[model];
    }


}
