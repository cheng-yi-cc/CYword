// 仅用于单词巧记展示；词书原文、词根巧记和引用保持不变。
export function wordMemoryDisplay(value?: string): string | undefined {
  return value?.replace(/(^|\n)([ \t]*)针对第\s*\d+\s*个元素采用词根词缀分析[：:][ \t]*/g, "$1$2");
}
