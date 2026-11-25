import {articleApprovalGrounding,articleGroundingMessage,hasGeneratedWritingBasis} from './article-grounding.js';
import {reviewWritingOutput} from './writing.js';
import {articleMediaRefs,articleMediaSnapshot} from './article-media-core.js';
export {articleMediaRefs,articleMediaSnapshot} from './article-media-core.js';

// Recompute against the current editing buffer. Saved model checks are separate.
export function articleWritingReview(article = {}, input = {}) {
  const text = String(input.text ?? article.text ?? ''), title = String(input.title ?? article.title ?? '').trim();
  const facts = Array.isArray(article.factSnapshots) ? article.factSnapshots : [];
  const review = reviewWritingOutput(text, {question:article.question||article.writingBasis?.qualityPlan?.readerQuestion,facts, articleContract:article.writingBasis?.articleContract});
  const labels = {
    reader_setting:'标题或开头引入了本题未包含的清洁场所，请围绕读者指定的场景修改。',
    reader_decision:'原问题要比较是否适合，请把开头改回候选对象的判断标准。',
    reader_deliverable:'请检查正文是否把资料整理写成客诉处理、法律审查或舆情应对。',
    body_present:'正文还没有可阅读的内容。',
    evidence_snapshot:'此生成稿没有保留事实依据，请核对正文来源。',
    known_fact_ids:'正文中的部分事实标记无法对应到本稿依据。',
    source_recorded:'部分关联依据未登记出处，请核对并补充来源。',
    duplicate_paragraphs:'发现完全重复的较长段落，请检查是否重复粘贴。'
  };
  const checks = [{id:'title_present', ok:!!title, detail:'请填写清楚的文章标题。'}];
  for (const check of review.checks) {
    if (!Object.hasOwn(labels, check.id)) continue;
    // Manually written/imported articles do not require a generation snapshot.
    if (check.id === 'evidence_snapshot' && !article.writingBasis && !article.provider) continue;
    checks.push({...check, detail:labels[check.id]});
  }
  const groundingFindings=hasGeneratedWritingBasis(article)?articleApprovalGrounding(article,{title,text},facts):[];
  if(groundingFindings.length)checks.push({id:'unsupported_capability',ok:false,detail:groundingFindings.map(f=>f.label+'：「'+f.quote+'」').join('；')+'。请核对对应出处或改正原句。'});
  return {...review, checks, groundingFindings};
}

// Shared editor transitions: editing an approved text always requires another review.
export function articleRevision(previous, input, intent, role) {
  const title = String(input.title || '').trim(), text = String(input.text || '').trim();
  if (!title || title.length > 160) throw new Error('请填写 1 至 160 字的标题');
  if (!text || text.length > 100000) throw new Error('请填写 1 至 100000 字的正文');
  if (Object.hasOwn(input, 'ai') && typeof input.ai !== 'boolean') throw new Error('AI 辅助声明格式无效');
  const ai = Object.hasOwn(input, 'ai') ? input.ai : !!previous?.ai;
  const hasMedia=Object.hasOwn(input,'mediaRefs')||Object.hasOwn(previous||{},'mediaRefs');
  const mediaRefs=hasMedia?articleMediaRefs(Object.hasOwn(input,'mediaRefs')?input.mediaRefs:previous.mediaRefs):undefined;
  const mediaChanged=hasMedia&&JSON.stringify(mediaRefs)!==JSON.stringify(previous?.mediaRefs||[]);
  const changed = !previous || previous.title !== title || previous.text !== text || !!previous.ai !== ai || mediaChanged;
  const writer = ['owner', 'admin', 'editor'].includes(role);
  const reviewer = ['owner', 'admin', 'reviewer'].includes(role);
  if (changed && !writer) throw new Error('当前角色不能修改稿件');
  if (!['save', 'submit', 'approve', 'reject'].includes(intent)) throw new Error('不支持的稿件操作');
  if (['save', 'submit'].includes(intent) && !writer) throw new Error('当前角色不能编辑或送审');
  if (['approve', 'reject'].includes(intent) && !reviewer) throw new Error('需要审核人或管理员确认');
  if (intent === 'approve' && (changed || previous?.status !== '待审核')) throw new Error('请先保存修改并提交审核，再审核通过');
  if (intent === 'approve') {const findings=articleApprovalGrounding(previous,{title,text},previous?.factSnapshots);if(findings.length)throw new Error(articleGroundingMessage(findings));}
  if (intent === 'reject' && changed) throw new Error('请先保存修改');
  const status = intent === 'submit' ? '待审核' : intent === 'approve' ? '已审核' : intent === 'reject' || changed ? '草稿' : previous.status;
  // Review-only transitions must preserve legacy records that omit the flag.
  const result = { ...previous, title, text, status, ...(writer && (Object.hasOwn(input, 'ai') || previous?.ai !== undefined) ? {ai} : {}) };
  if(hasMedia){result.mediaRefs=mediaRefs;result.mediaVersion=(articleMediaSnapshot(previous).mediaVersion||0)+(mediaChanged?1:0)||1;}
  if (changed) { delete result.reviewedAt; delete result.reviewNote; delete result.writingReview; }
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
