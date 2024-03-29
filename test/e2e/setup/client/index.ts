import {TestcaseRunner} from "./TestcaseRunner";
import "./specs/tests"
import {syncModels} from "../models/syncModels";
import SQLjs from 'sql.js';
import {Database, DatabaseOptions} from "@ainias42/typeorm-sync";

const runner = TestcaseRunner.getInstance();
runner.setDisplay(document.getElementById("state-display") as HTMLDivElement);
runner.displayTestSelection(document.getElementById("tests"));

window["runner"] = runner;

const databaseOptions: DatabaseOptions = {
    type: 'sqljs',
    location: 'typeormSync',
    driver: SQLjs,
    sqlJsConfig: {
        locateFile: (file: string) => {
            return `/${file}`;
        },
    },
    autoSave: true,
    useLocalForage: true,
    synchronize: true,
    logging: false,
    isClient: true,
    persist: "/api/persist",
    query: '/api/sync',
    remove: '/api/db/remove',
};

Database.setSyncModels(syncModels);
window["initPromise"] = Database.init(databaseOptions);
