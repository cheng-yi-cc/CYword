export type ViewName = "home" | "plan" | "today" | "vocabulary" | "search";
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
  exposureOrder?: number[];
  segmentEnds?: number[];
  appearanceCount: number;
  uniqueWordCount: number;
}

export interface PlanDay {
  day: number;
  kind: "study" | "review";
  studyDay?: number;
  groupIds: string[];
  exposureOrder?: number[];
  segmentEnds?: number[];
  exposureKeys?: string[];
  appearanceCount: number;
  uniqueWordCount: number;
  plannedReviewWordCount?: number;
}

export interface Catalog {
  generatedAt?: string;
  dataVersion: string;
  book: {
    code: string;
    name: string;
    targetExam: string;
    schemaVersion: number;
  };
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

export interface PronunciationGuide {
  /** 对应当前词书读音；分块用于学习，不表示词根或词典断字。 */
  pronunciation: string;
  chunks: Array<{ text: string; ipa: string; stress: "none" | "primary" | "secondary" }>;
  notes: string[];
}

export interface MeaningBridge {
  pairId: string;
  anchorId: string;
  anchorSpelling: string;
  relation: "near_synonym" | "antonym";
  explanation: string;
}

export interface WordDetail extends WordSummary {
  meaningBridges?: MeaningBridge[];
  pronunciationGuide?: PronunciationGuide;
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

export interface WordsRequest {
  dataVersion: string;
  planDay: number;
  kind: "study" | "review" | "bookmarks";
  wordIds: string[];
}

export interface WordsResponse {
  dataVersion: string;
  wordCount: number;
  words: Record<string, WordDetail>;
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
  bookmarkChanges?: Record<string, { at: string; saved: boolean }>;
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

export interface AuthUser {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number;
  loginCount: number;
}

export interface UserSession {
  token: string;
  user: AuthUser;
}

export interface SendCodeResponse {
  success: boolean;
  message?: string;
  simulated?: boolean;
  debugCode?: string;
  error?: string;
}

export interface VerifyCodeResponse {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

export interface UpdateStatus {
  status: "idle" | "available" | "downloading" | "downloaded";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
}

declare global {
  interface Window {
    cyword: {
      androidUpdates?: import("./android-updates").AndroidUpdates;
      readCatalog: () => Promise<Catalog>;
      readWords: (request: WordsRequest) => Promise<WordsResponse>;
      readProgress: (accountId?: string) => Promise<unknown>;
      writeProgress: (progress: AppProgress, accountId?: string) => Promise<boolean>;
      syncProgress?: (token: string, payload?: { revision: number; progress: AppProgress }) => Promise<{ status: number; data: { revision: number; progress: AppProgress; error?: string } }>;
      sendAuthCode?: (email: string) => Promise<SendCodeResponse>;
      verifyAuthCode?: (email: string, code: string) => Promise<VerifyCodeResponse>;
      getAuthUser?: (token: string) => Promise<{ success: boolean; user: AuthUser }>;
      readSession?: () => Promise<UserSession | null>;
      writeSession?: (session: UserSession) => Promise<boolean>;
      clearSession?: () => Promise<boolean>;
      getUpdateStatus?: () => Promise<UpdateStatus>;
      downloadUpdate?: () => Promise<UpdateStatus>;
      installUpdate?: () => Promise<boolean>;
      onUpdateStatus?: (listener: (status: UpdateStatus) => void) => () => void;
    };
  }
}
