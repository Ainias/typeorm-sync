import type { SyncError } from './SyncError';
import { SyncContainer } from "../Sync/SyncTypes";
export declare type SyncResult<Error extends SyncError> = {
    success: true;
    syncContainer: SyncContainer;
    lastQueryDate: string;
    deleted: number[];
} | {
    success: false;
    error: Error;
};
