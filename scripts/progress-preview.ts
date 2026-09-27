import { progressToRecords, recordsToProgress, type ProgressRecord } from '../src/progress-records.ts';
import { canonicalProgress } from '../src/progress-business.ts';
import type { AppProgress, Catalog } from '../src/types.ts';

/** In-memory preview/test service only; deployed APIs always use authenticated D1. */
export function createProgressPreview(catalog: Catalog, state: { remote: AppProgress; revision: number }) {
  const batches = new Map<string, Map<number, ProgressRecord[]>>();
  const protocol = { protocol: 2, bookCode: catalog.book.code, curriculumVersion: catalog.curriculumVersion ?? catalog.dataVersion };
  return async (operation: Record<string, any>) => {
    let data: Record<string, unknown> = {}, status = 200;
    if (operation.action === 'read') {
      const records = operation.after === state.revision ? [] : [...progressToRecords(state.remote).values()].filter(r => r.id > operation.cursor);
      data = { records: records.slice(0, 32), cursor: records.length > 32 ? records[31].id : null };
    } else if (operation.revision !== state.revision) status = 409;
    else if (operation.action === 'stage') {
      const batch = batches.get(operation.batchId) ?? new Map();
      batch.set(operation.part, structuredClone(operation.records)); batches.set(operation.batchId, batch);
    } else if (operation.action === 'commit') {
      const batch = batches.get(operation.batchId);
      if (!batch) throw new Error('Preview batch missing');
      const records = progressToRecords(state.remote);
      for (const part of batch.values()) for (const record of part) records.set(record.id, record);
      state.remote = canonicalProgress(recordsToProgress(records.values()), catalog);
      state.revision++; batches.delete(operation.batchId);
    } else throw new Error('Unknown preview action');
    return { status, data: { ...protocol, revision: state.revision, ...data } };
  };
}
