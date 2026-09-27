import type { WordDetail } from "./types.ts";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
/** Reject broken transport payloads before exposing rating controls. No source text is rewritten. */
export function validWordDetail(value: unknown): value is WordDetail {
  if (!record(value)) return false;
  for (const field of ["id", "bookCode", "spelling", "pronunciation", "definitionCn", "audioUrl", "memoryMarkup", "etymologyMarkup"]) if (typeof value[field] !== "string") return false;
  for (const field of ["roots", "examples", "examExamples", "collocations", "frequencies", "relations", "longSentences", "sentenceZones"]) {
    if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every(record)) return false;
  }
  if (!(value.roots as Record<string, unknown>[]).every(root => ["id", "spelling", "type", "meaning", "memoryMethod"].every(field => typeof root[field] === "string") && Number.isFinite(root.order))) return false;
  return (value.longSentences as Record<string, unknown>[]).every(sentence => Array.isArray(sentence.segments) && sentence.segments.every(record) && Array.isArray(sentence.analyses) && sentence.analyses.every(record));
}
