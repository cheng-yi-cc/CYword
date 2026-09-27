import { canonicalProgress } from './progress-business.ts';
import { progressToRecords, recordsToProgress, type ProgressRecord } from './progress-records.ts';
import type { AppProgress, Catalog } from './types.ts';

export type IncrementalResponse = { status: number; data: any };
type Request = (operation: Record<string, unknown>) => Promise<IncrementalResponse>;
class HttpFailure extends Error {
  readonly response: IncrementalResponse;
  constructor(response: IncrementalResponse) { super(response.data?.error || `同步请求失败（${response.status}）`); this.response = response; }
}

/** Account-scoped transport. Only a complete, validated revision is published. */
export class IncrementalProgressTransport {
  private records = new Map<string, ProgressRecord>();
  private revision = 0;
  private snapshot: AppProgress | null = null;
  private stopped = false;
  private catalog: Catalog;
  private send: Request;
  private wordIds: Set<string>;
  constructor(catalog: Catalog, send: Request) { this.catalog = catalog; this.send = send; this.wordIds = new Set(catalog.groups.flatMap(g => g.wordIds)); }
  stop() { this.stopped = true; }
  private async call(operation: Record<string, unknown>) {
    if (this.stopped) throw new Error('同步会话已结束');
    const response = await this.send({ ...operation, protocol: 2, bookCode: this.catalog.book.code,
      curriculumVersion: this.catalog.curriculumVersion ?? this.catalog.dataVersion });
    if (this.stopped) throw new Error('同步会话已结束');
    if (response.status !== 200 && response.status !== 409) throw new HttpFailure(response);
    const data = response.data;
    if (data?.protocol !== 2 || data.bookCode !== this.catalog.book.code || data.curriculumVersion !== (this.catalog.curriculumVersion ?? this.catalog.dataVersion)
      || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('同步服务返回的版本无效，本机记录已保留');
    return response;
  }
  private async read() {
    const next = new Map(this.records);
    let after = this.snapshot ? this.revision : 0;
    for (let pass = 0; pass < 8; pass++) {
      let cursor = '', first = -1, last = -1;
      do {
        const { data, status } = await this.call({ action: 'read', after, cursor });
        if (status !== 200 || !Array.isArray(data.records) || data.records.length > 32 || data.revision < after
          || (data.cursor !== null && typeof data.cursor !== 'string')) throw new Error('云端增量读取无效，本机记录已保留');
        if (first < 0) first = data.revision;
        last = data.revision;
        for (const record of data.records) {
          if (!record || typeof record.id !== 'string' || !(record.id.startsWith('w/') ? this.wordIds.has(record.id.slice(2)) : /^d\/[0-9]{2}$/.test(record.id))) throw new Error('云端记录无效');
          if (record.deleted === true && record.value === null) next.delete(record.id);
          else {
            if (!record.value || typeof record.value !== 'object') throw new Error('云端记录无效');
            next.set(record.id, record);
          }
        }
        if (next.size > 6000 || (data.cursor && data.cursor <= cursor)) throw new Error('云端分页无效');
        cursor = data.cursor ?? '';
      } while (cursor);
      // Any writes during pagination are re-read from the first observed head.
      // Until a stable pass, partial queue membership never reaches local storage.
      if (first !== last) { after = first; continue; }
      if (this.snapshot && last === this.revision) return { revision: last, progress: this.snapshot };
      const progress = canonicalProgress(recordsToProgress(next.values()), this.catalog);
      this.records = next; this.revision = last; this.snapshot = progress;
      return { revision: last, progress };
    }
    throw new Error('云端正在连续更新，已保留本机记录，将稍后继续同步');
  }
  async request(payload?: { revision: number; progress: AppProgress }, knownRevision?: number) {
    try {
      if (!payload) {
        const data = await this.read();
        return { status: knownRevision === data.revision ? 304 : 200, data };
      }
      if (!this.snapshot || this.revision !== payload.revision) {
        return { status: 409, data: await this.read() };
      }
      const candidate = progressToRecords(canonicalProgress(payload.progress, this.catalog));
      const baseline = progressToRecords(this.snapshot);
      const changed = [...candidate.values()].filter(record => JSON.stringify(record) !== JSON.stringify(baseline.get(record.id)));
      if (!changed.length) return { status: 200, data: await this.read() };
      const parts: ProgressRecord[][] = [[]];
      let bytes = 0;
      for (const record of changed) {
        const size = new TextEncoder().encode(JSON.stringify(record)).length;
        if (size > 18000) throw new Error('单词进度超出大小限制，本机记录已保留');
        if (parts.at(-1)!.length >= 24 || bytes + size > 60000) { parts.push([]); bytes = 0; }
        parts.at(-1)!.push(record); bytes += size;
      }
      const batchId = crypto.randomUUID();
      // Bounded concurrency keeps initial restoration practical without request storms.
      for (let start = 0; start < parts.length; start += 4) {
        const responses = await Promise.all(parts.slice(start, start + 4).map((records, offset) => this.call({
          action: 'stage', batchId, revision: payload.revision, part: start + offset, parts: parts.length, records,
        })));
        if (responses.some(r => r.status === 409)) return { status: 409, data: await this.read() };
      }
      const response = await this.call({ action: 'commit', batchId, revision: payload.revision });
      return { status: response.status, data: await this.read() };
    } catch (error) {
      if (error instanceof HttpFailure) return { status: error.response.status, data: {
        revision: this.revision, progress: this.snapshot ?? recordsToProgress([]), error: error.message,
      } };
      throw error;
    }
  }
}
