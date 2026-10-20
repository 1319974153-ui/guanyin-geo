// Shared editor transitions: editing an approved text always requires another review.
export function articleRevision(previous, input, intent, role) {
  const title = String(input.title || '').trim(), text = String(input.text || '').trim();
  if (!title || title.length > 160) throw new Error('请填写 1 至 160 字的标题');
  if (!text || text.length > 100000) throw new Error('请填写 1 至 100000 字的正文');
  if (Object.hasOwn(input, 'ai') && typeof input.ai !== 'boolean') throw new Error('AI 辅助声明格式无效');
  const ai = Object.hasOwn(input, 'ai') ? input.ai : !!previous?.ai;
  const changed = !previous || previous.title !== title || previous.text !== text || !!previous.ai !== ai;
  const writer = ['owner', 'admin', 'editor'].includes(role);
  const reviewer = ['owner', 'admin', 'reviewer'].includes(role);
  if (changed && !writer) throw new Error('当前角色不能修改稿件');
  if (!['save', 'submit', 'approve', 'reject'].includes(intent)) throw new Error('不支持的稿件操作');
  if (['save', 'submit'].includes(intent) && !writer) throw new Error('当前角色不能编辑或送审');
  if (['approve', 'reject'].includes(intent) && !reviewer) throw new Error('需要审核人或管理员确认');
  if (intent === 'approve' && (changed || previous?.status !== '待审核')) throw new Error('请先保存修改并提交审核，再审核通过');
  if (intent === 'reject' && changed) throw new Error('请先保存修改');
  const status = intent === 'submit' ? '待审核' : intent === 'approve' ? '已审核' : intent === 'reject' || changed ? '草稿' : previous.status;
  // Review-only transitions must preserve legacy records that omit the flag.
  const result = { ...previous, title, text, status, ...(writer && (Object.hasOwn(input, 'ai') || previous?.ai !== undefined) ? {ai} : {}) };
  if (changed) { delete result.reviewedAt; delete result.reviewNote; }
  if (intent === 'approve') result.reviewedAt = new Date().toISOString();
  return result;
}

export function markdownInsertion(text, start, end, kind) {
  const selected = text.slice(start, end);
  const syntax = {
    heading: ['## ', '', '小节标题'], bold: ['**', '**', '重点内容'],
    list: ['- ', '', '列表项目'], quote: ['> ', '', '引用内容'],
    code: ['```\n', '\n```', '代码'], link: ['[', '](https://)', '链接文字']
  }[kind];
  if (!syntax) throw new Error('不支持的格式');
  const [before, after, fallback] = syntax;
  const prefix = ['heading', 'list', 'quote', 'code'].includes(kind) && start > 0 && text[start - 1] !== '\n' ? '\n' : '';
  const value = selected || fallback, insert = prefix + before + value + after;
  return { text: text.slice(0, start) + insert + text.slice(end), start: start + prefix.length + before.length, end: start + prefix.length + before.length + value.length };
}
