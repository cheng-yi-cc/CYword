// A root recap supplies its meaning locally; its linked example remains available in the popover.
function referenceOnly(word, spelling) {
  const contexts = (word.memoryMarkup + "\n" + word.etymologyMarkup).split(/[。\n]/u)
    .filter(text => [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu)].some(match => match[1].trim().toLowerCase() === spelling));
  return contexts.length > 0 && contexts.every(text => /词根词缀分析|作词根|作为词根|看作词根/u.test(text) && /表示|变体|意为/u.test(text));
}

export function extractDependencies(words) {
  const wordBySpelling = new Map(words.map(word => [word.spelling.toLowerCase(), word]));
  const prereqPatterns = [
    /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(?:为|是)?(?:已经|已)?(?:记忆过|学过|掌握|熟知)?(?:的)?(?:单词|熟词)/gu,
    /(?:记忆|学过|学习|接触过|复习)?(?:单词)?\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(?:时|中)?(?:已经|已)?(?:接触过|学过|记忆过|见过)/gu,
    /在记忆(?:单词)?\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu,
    /由(?:熟词|单词)?\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu,
    /基于(?:已经记忆过的)?(?:单词)?\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu,
    /熟词\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu,
    /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*为熟词/gu,
    /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*为已学/gu,
  ];

  const wordDeps = [];

  for (const w of words) {
    const combined = `${w.memoryMarkup || ""}\n${w.etymologyMarkup || ""}`;
    const foundPrereqs = new Set();

    for (const pat of prereqPatterns) {
      for (const m of combined.matchAll(pat)) {
        if (m[1] && m[1].toLowerCase() !== w.spelling.toLowerCase()) {
          foundPrereqs.add(m[1].toLowerCase());
        }
      }
    }

    const sentences = combined.split(/[。\n；]/);
    for (const sentence of sentences) {
      if (/已经记忆过|已经接触过|已学|记忆单词|在记忆.*时|已经学过|熟词/u.test(sentence)) {
        for (const link of sentence.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
          const target = link[1].trim().toLowerCase();
          if (!target.startsWith("-") && !target.endsWith("-") && target !== w.spelling.toLowerCase()) {
            foundPrereqs.add(target);
          }
        }
      }
    }

    for (const targetSpelling of foundPrereqs) {
      const targetWord = wordBySpelling.get(targetSpelling);
      if (targetWord && targetWord.id !== w.id) {
        wordDeps.push({
          sourceWordId: w.id,
          targetWordId: targetWord.id,
          kind: referenceOnly(w, targetSpelling) ? "reference" : "required",
        });

      }
    }
  }

  return wordDeps;
}

function components(ids, dependencies) {
  let index = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), result = [];
  function visit(id) {
    indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const dep of dependencies.get(id)) {
      if (!indices.has(dep)) { visit(dep); low.set(id, Math.min(low.get(id), low.get(dep))); }
      else if (active.has(dep)) low.set(id, Math.min(low.get(id), indices.get(dep)));
    }
    if (low.get(id) === indices.get(id)) {
      const group = []; let item;
      do { item = stack.pop(); active.delete(item); group.push(item); } while (item !== id);
      result.push(group);
    }
  }
  for (const id of ids) if (!indices.has(id)) visit(id);
  return result;
}

/** Keep mutually dependent root groups on the same day, then order their actual exposures. */
export function buildLearningSchedule(allGroups, words, dependencies, target = 190) {
  const wordMap = new Map(words.map(word => [word.id, word]));
  const groupMap = new Map(allGroups.map(group => [group.id, group]));
  const groupsByWord = new Map();
  for (const group of allGroups) for (const id of group.wordIds) {
    if (!groupsByWord.has(id)) groupsByWord.set(id, []);
    groupsByWord.get(id).push(group.id);
  }
  const required = new Map(words.map(word => [word.id, new Set()]));
  const references = new Map(words.map(word => [word.id, new Set()]));
  const incoming = new Map(allGroups.map(group => [group.id, new Set()]));
  for (const dep of dependencies) {
    (dep.kind === "reference" ? references : required).get(dep.sourceWordId).add(dep.targetWordId);
    if (dep.kind === "reference") continue;
    for (const id of groupsByWord.get(dep.sourceWordId)) {
      if (groupMap.get(id).wordIds.includes(dep.targetWordId)) continue;
      for (const prerequisiteGroup of groupsByWord.get(dep.targetWordId)) incoming.get(id).add(prerequisiteGroup);
    }
  }
  const compare = (a, b) => a.firstOrder - b.firstOrder || a.id.localeCompare(b.id, "en");
  const units = components([...groupMap.keys()], incoming).map((ids, index) => {
    const groups = ids.map(id => groupMap.get(id)).sort(compare);
    return { id: index, key: ids.toSorted()[0], groups, firstOrder: Math.min(...groups.map(group => group.firstOrder)),
      size: groups.reduce((n, group) => n + group.wordCount, 0),
      singles: groups.filter(group => group.wordCount === 1).length,
      dependencies: new Set(), exposures: [] };
  });
  const unitByGroup = new Map(units.flatMap(unit => unit.groups.map(group => [group.id, unit.id])));
  for (const unit of units) for (const group of unit.groups) for (const id of incoming.get(group.id)) {
    const other = unitByGroup.get(id);
    if (other !== unit.id) unit.dependencies.add(other);
  }
  const ratio = allGroups.filter(group => group.wordCount === 1).length / allGroups.length;
  const learned = new Set(), visited = new Set(), ordered = [];
  let singles = 0, count = 0, singleRun = 0;
  while (ordered.length < units.length) {
    const ready = units.filter(unit => !visited.has(unit.id) && [...unit.dependencies].every(id => visited.has(id)));
    if (!ready.length) throw new Error("Unresolved curriculum dependency cycle");
    const wantSingle = singleRun < Math.ceil(ratio / (1 - ratio)) && singles < (count + 1) * ratio;
    const missingReferences = unit => new Set(unit.groups.flatMap(group => group.wordIds.flatMap(id => [...references.get(id)]))).difference(learned).size;
    const referenceCounts = new Map(ready.map(unit => [unit.id, missingReferences(unit)]));
    ready.sort((a, b) => Number((b.size === 1) === wantSingle) - Number((a.size === 1) === wantSingle)
      || referenceCounts.get(a.id) - referenceCounts.get(b.id) || a.firstOrder - b.firstOrder || a.key.localeCompare(b.key, "en"));
    const unit = ready[0];
    // Stay in a root group where possible; visit a partner group's prerequisite only when needed.
    const pending = unit.groups.flatMap(group => [...group.wordIds]
      .sort((a, b) => wordMap.get(a).originalOrder - wordMap.get(b).originalOrder || a.localeCompare(b, "en"))
      .map(wordId => ({ groupId: group.id, wordId })));
    while (pending.length) {
      const nextIndex = pending.findIndex(item => [...required.get(item.wordId)].every(id => learned.has(id)));
      if (nextIndex < 0) {
        throw new Error(`Conflicting required word dependencies: ${[...new Set(pending.map(item => wordMap.get(item.wordId).spelling))].join(", ")}`);
      }
      const [next] = pending.splice(nextIndex, 1);
      unit.exposures.push(next); learned.add(next.wordId);
    }
    const groupOrder = [...new Set(unit.exposures.map(item => item.groupId))];
    unit.groups = groupOrder.map(id => ({ ...groupMap.get(id), wordIds: unit.exposures.filter(item => item.groupId === id).map(item => item.wordId) }));
    for (const group of unit.groups) singleRun = group.wordCount === 1 ? singleRun + 1 : 0;
    visited.add(unit.id); ordered.push(unit); singles += unit.singles; count += unit.groups.length;
  }
  const groups = ordered.flatMap(unit => unit.groups);
  const schedule = packStudyDays(ordered, target);
  return { groups, schedule };
}

// Choose day boundaries together, so a larger inseparable unit cannot overload its neighbour.
function packStudyDays(units, target) {
  const total = units.reduce((n, unit) => n + unit.size, 0);
  const dayCount = Math.ceil(Math.ceil(total / target) / 3) * 3;
  if (units.length < dayCount) throw new Error("Too few learning units for the study-day cadence");
  const average = total / dayCount;
  const maxDaySize = Math.max(Math.ceil(target * 1.25), ...units.map(unit => unit.size));
  const costs = Array.from({ length: dayCount + 1 }, () => new Float64Array(units.length + 1).fill(Infinity));
  const previous = Array.from({ length: dayCount + 1 }, () => new Int32Array(units.length + 1).fill(-1));
  costs[0][0] = 0;
  for (let day = 1; day <= dayCount; day++) for (let end = day; end <= units.length; end++) {
    let size = 0;
    for (let start = end - 1; start >= day - 1; start--) {
      size += units[start].size;
      if (size > maxDaySize) break;
      const cost = costs[day - 1][start] + (size - average) ** 2;
      if (cost < costs[day][end]) { costs[day][end] = cost; previous[day][end] = start; }
    }
  }
  if (!Number.isFinite(costs[dayCount][units.length])) throw new Error("Unable to balance whole root groups into study days");
  const days = []; let end = units.length;
  for (let day = dayCount; day > 0; day--) {
    const start = previous[day][end], selected = units.slice(start, end);
    const groups = selected.flatMap(unit => unit.groups), exposures = selected.flatMap(unit => unit.exposures);
    const flat = groups.flatMap(group => group.wordIds.map(wordId => `${group.id}:${wordId}`));
    const positions = new Map(flat.map((key, index) => [key, index]));
    const order = exposures.map(item => positions.get(`${item.groupId}:${item.wordId}`));
    // 休息点仅添加展示元数据，完整保留同日互依单元、词根组与曝光顺序。
    const segmentEnds = [];
    let segmentSize = 0, exposureEnd = 0;
    for (const unit of selected) {
      exposureEnd += unit.exposures.length;
      segmentSize += unit.exposures.length;
      if (segmentSize >= 20) { segmentEnds.push(exposureEnd); segmentSize = 0; }
    }
    if (segmentEnds.at(-1) !== exposures.length) segmentEnds.push(exposures.length);
    days.unshift({ day, groupIds: groups.map(group => group.id), appearanceCount: flat.length,
      uniqueWordCount: new Set(exposures.map(item => item.wordId)).size,
      segmentEnds,
      ...(order.some((index, i) => index !== i) ? { exposureOrder: order } : {}) });
    end = start;
  }
  return days;
}
