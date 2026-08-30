export type ViewName = "home" | "plan" | "today" | "vocabulary";
export type Proficiency = "unmastered" | "unclear" | "mastered";

export interface WordSummary {
  id: string;
  spelling: string;
  pronunciation: string;
  definitionCn: string;
}

export interface StudyGroup {
  id: string;
  kind: "root" | "solo";
  rootId: string | null;
  spelling: string;
  meaning: string;
  memoryMethod: string;
  wordIds: string[];
  wordCount: number;
  firstOrder: number;
}

export interface StudyDayPlan {
  day: number;
  groupIds: string[];
  appearanceCount: number;
  uniqueWordCount: number;
}

export interface PlanDay {
  day: number;
  kind: "study" | "review";
  studyDay?: number;
  groupIds: string[];
  appearanceCount: number;
  uniqueWordCount: number;
  plannedReviewWordCount?: number;
}

export interface Catalog {
  generatedAt: string;
  stats: {
    wordCount: number;
    trueRootCount: number;
    soloGroupCount: number;
    studyGroupCount: number;
    studyAppearanceCount: number;
    scheduleDayCount: number;
    targetPerDay: number;
  };
  groups: StudyGroup[];
  schedule: StudyDayPlan[];
  words: Record<string, WordSummary>;
}

export interface RootPart {
  id: string;
  order: number;
  spelling: string;
  type: "root" | "prefix" | "suffix" | "base";
  meaning: string;
  memoryMethod: string;
}

export interface WordDetail extends WordSummary {
  audioUrl: string;
  memoryMarkup: string;
  etymologyMarkup: string;
  rootAffixNotes: string;
  rootAffixAccumulation: string;
  bookCode: string;
  bookName: string;
  originalDay: number;
  originalOrder: number;
  sourceStats: Record<string, number | string | boolean>;
  roots: RootPart[];
  examples: Record<string, string>[];
  examExamples: Record<string, string>[];
  collocations: Record<string, string>[];
  frequencies: Record<string, string>[];
  relations: Array<Record<string, unknown> & { words: Record<string, string>[] }>;
  longSentences: Array<Record<string, unknown> & {
    segments: Record<string, string>[];
    analyses: Record<string, string>[];
  }>;
  sentenceZones: Record<string, string>[];
}

export interface WordProgress {
  learnedAt: string;
  lastSeenAt: string;
  proficiency: Proficiency;
  reviewCount: number;
  exposures: number;
}

export interface PlanDayProgress {
  kind: "study" | "review";
  startedAt: string;
  completedAt?: string;
  completedGroupIds: string[];
  ratedExposureKeys: string[];
  reviewWordIds: string[];
  reviewedWordIds: string[];
  skipMastered: boolean;
}

export interface AppProgress {
  version: 2;
  planDays: Record<string, PlanDayProgress>;
  words: Record<string, WordProgress>;
  bookmarks: Record<string, string>;
  reviewHistory: Array<{
    wordId: string;
    date: string;
    proficiency: Proficiency;
    planDay: number;
  }>;
}

declare global {
  interface Window {
    cyword: {
      readCatalog: () => Promise<Catalog>;
      readWord: (wordId: string) => Promise<WordDetail>;
      readProgress: () => Promise<unknown>;
      writeProgress: (progress: AppProgress) => Promise<boolean>;
    };
  }
}
