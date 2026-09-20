/** Returns the completed segment's end only when the next pending word is beyond it. */
export function completedSegmentEnd(
  ends: number[] | undefined,
  index: number,
  nextIndex: number,
  exposures: Array<{ key: string }>,
  completed: Set<string>,
): number | null {
  const boundaries = ends?.length ? ends : [exposures.length];
  const boundaryIndex = boundaries.findIndex(end => index < end);
  const end = boundaries[boundaryIndex];
  const start = boundaryIndex > 0 ? boundaries[boundaryIndex - 1] : 0;
  if (end === undefined || nextIndex < end || end >= exposures.length) return null;
  return exposures.slice(start, end).every(item => completed.has(item.key)) ? end : null;
}
