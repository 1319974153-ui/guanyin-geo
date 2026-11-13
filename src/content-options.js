// The same cross-brand choices are used by the planner and browser UI.
// Historical values remain valid only to resume existing proposals unchanged.
export const CONTENT_GOALS = Object.freeze([
  '提升品牌认知',
  '突出优势与特色',
  '建立信任',
  '解答用户疑问',
  '帮助比较与选择'
]);

export const CONTENT_FORMATS = Object.freeze([
  'AI 推荐',
  '品牌介绍',
  '产品或服务介绍',
  '案例故事',
  '知识科普',
  '对比指南',
  '常见问答'
]);

export const CONTENT_TONES = Object.freeze([
  'AI 推荐',
  '专业清晰',
  '通俗易懂',
  '生动有趣'
]);

export const WRITING_CHOICES = Object.freeze({
  goal: CONTENT_GOALS,
  format: CONTENT_FORMATS,
  tone: CONTENT_TONES
});

export const LEGACY_WRITING_CHOICES = Object.freeze({
  goal: Object.freeze(['帮助客户判断是否匹配', '解释一个真实交付方法', '补齐可核对的案例信息', '澄清一个常见误区']),
  format: Object.freeze(['选型指南', '案例拆解', '方法清单', '问答文章']),
  tone: Object.freeze(['克制专业', '客户易读', '技术复盘'])
});

export function isContentOption(key, value) {
  return Object.hasOwn(WRITING_CHOICES, key)
    && (WRITING_CHOICES[key].includes(value) || LEGACY_WRITING_CHOICES[key].includes(value));
}
