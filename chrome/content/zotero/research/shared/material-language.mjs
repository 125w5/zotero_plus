// Display translations are separate from original research assets.
export const hasChinese = text => /[\u3400-\u9fff]/u.test(String(text || ''));
export function chineseSummary(m) {
 if (hasChinese(m.summary)) return m.summary;
 if (m.summaryZhRevision === m.revision && hasChinese(m.summaryZh)) return m.summaryZh;
 if (m.data?.rows) return `${Math.max(0,m.data.rows.length-1)} 条实验记录 · ${m.data.rows[0]?.length||0} 列；原始数据可点击查看。`;
 return m.summaryZhError ? '中文说明暂未完成；原文已保留，可重试整理。' : '正在整理中文说明；原文与来源已保留。';
}
