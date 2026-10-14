import { proto } from '../../WAProto/index.js';
import type { ZeonnByteEventEmitter, ZeonnByteEventMap, Contact } from '../Types/index.js';
import type { ILogger } from './logger.js';
export type ContactsUpsertResult = {
    event: 'contacts.upsert';
    data: Contact[];
};
export type LidMappingUpdateResult = {
    event: 'lid-mapping.update';
    data: ZeonnByteEventMap['lid-mapping.update'];
};
export type SyncActionResult = ContactsUpsertResult | LidMappingUpdateResult;
/**
 * Process contactAction and return events to emit.
 * Pure function - no side effects.
 */
export declare const processContactAction: (action: proto.SyncActionValue.IContactAction, id: string | undefined, logger?: ILogger) => SyncActionResult[];
export declare const emitSyncActionResults: (ev: ZeonnByteEventEmitter, results: SyncActionResult[]) => void;
//# sourceMappingURL=sync-action-utils.d.ts.map