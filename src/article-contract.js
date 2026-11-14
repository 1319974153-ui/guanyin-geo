import {CONTENT_GOALS, CONTENT_FORMATS, CONTENT_TONES, isContentOption} from './content-options.js';

const GOAL_REQUIREMENTS = {
  '提升品牌认知':'让读者理解品牌是什么、与当前问题有什么关系、适合什么情境；身份与能力只取自资料，不把品牌介绍扩写成无依据的资历宣传。',
  '突出优势与特色':'提炼与本题相关且有资料支持的特点，解释这些特点对读者的实际意义；没有同口径比较资料，不推导领先、独有或优于竞品。',
  '建立信任':'用可回查的事实、明确的适用条件和来源建立信任；区分能力、交付物与实际效果，不用虚构评价或夸大服务规模代替证据。',
  '解答用户疑问':'优先解答选定读者的具体疑问，再解释条件和必要细节；只有帮助回答问题的品牌信息才进入正文。',
  '帮助比较与选择':'围绕读者条件提出比较维度和取舍依据；资料不足时提供核对方法，不编造竞争者、价格、评分或推荐排序。'
};
const FORMAT_REQUIREMENTS = {
  'AI 推荐':[
    '沿用选定方向 brief 中解释的文体选择；若未说明具体文体，根据资料采用清晰的介绍或问答，不把“AI 推荐”写成品牌已被模型推荐的事实。',
    '组织方式服务于本题与已有材料，不自动套用技术项目、软件功能或实施交付案例。'
  ],
  '品牌介绍':[
    '以当前读者问题为入口，介绍资料能够支持的品牌身份、特点、适用对象及边界；名称、主体与经历保持原归属。',
    '只选与本题相关的品牌信息，不强行添加软件功能、项目交付过程、合作候选排名或案例成果。'
  ],
  '产品或服务介绍':[
    '说明读者可获得什么、适用情境及资料中已有的使用或购买条件；功能、规格、服务范围与限制保留原口径。',
    '没有价格、有效期、操作经历或结果材料时不补造，也不把普通商品与生活服务改写成软件项目。'
  ],
  '案例故事':[
    '围绕一个有材料支持的具体事件，区分背景、实际行动、相关主体与已观察结果；结果缺失时只陈述行动与产物。',
    '没有实际案例材料时收窄为已确认的产品或服务场景，明确它不是已发生的客户案例；不得编造人物、对话、情节、评价或效果。'
  ],
  '知识科普':[
    '围绕一个概念或常见困惑，解释含义、判断方法与适用条件；例子仅用于说明，假设示例明确标识。',
    '品牌信息只在与知识点有关时出现；缺少资料的专业结论标记待核对，不将模型常识当作本次核验依据。'
  ],
  '对比指南':[
    '先确定读者的需求和比较口径，再说明资料支持的区别与适用条件；不同统计周期、规格或对象不可直接对比。',
    '没有可比对象的资料时改为选择标准与问题清单，并说明尚不能得出优劣结论；不强行制造对照表或分数。'
  ],
  '常见问答':[
    '按选定方向组织相关问题，每个问题先直接回答，再补充必要条件与资料；问题数量由真实需求决定。',
    '避免用不同问法反复宣传同一卖点，不虚构用户咨询记录；没有答案依据时说明缺口或核对路径。'
  ],
  '方法清单':[
    '围绕读者任务说明必要输入、步骤、检查点和输出；未发生或未实测的步骤明确标为建议方法。',
    '方法应适合当前品牌场景，不强行套用开发、部署、软件测试或项目交付流程。'
  ]
};
const LEGACY_GOALS = {
  '帮助客户判断是否匹配':'帮助比较与选择',
  '解释一个真实交付方法':'解答用户疑问',
  '补齐可核对的案例信息':'建立信任',
  '澄清一个常见误区':'解答用户疑问'
};
const LEGACY_FORMATS = {'选型指南':'对比指南','案例拆解':'案例故事','问答文章':'常见问答'};
const TONE_REQUIREMENTS = {
  'AI 推荐':'沿用方向 brief 中记录的语气；未记录时采用清晰易懂的语言，不虚构品牌人格、对话或亲历。',
  '专业清晰':'术语准确，必要时解释含义；用事实与逻辑说明，避免术语堆积。',
  '通俗易懂':'采用日常语言和具体解释，不为易读而删除必要的条件、归属或限制。',
  '生动有趣':'可用易理解的比喻或已标识的假设例子，但不得补造人物、经历、评价或品牌成果。',
  '克制专业':'用准确、克制的语言解释事实和条件，不增加未经确认的评价。',
  '客户易读':'优先解释读者关心的问题，用日常语言保留关键条件。',
  '技术复盘':'仅在材料涉及技术过程时展开技术细节，区分实际操作、观察结果和待验证方案。'
};

function problem(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
function option(selection, key, fallback) {
  const value = selection[key] == null ? fallback : selection[key];
  if (typeof value !== 'string' || !isContentOption(key, value.trim())) problem('文章目标、形式或表达方式不在可选范围内');
  return value.trim();
}
function text(value, maximum, label) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > maximum) problem(`${label}格式不正确`);
  return value.trim();
}
function list(value, maximum, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximum) problem(`${label}格式不正确`);
  return value.map(item => text(item, 180, label));
}

// A composition contract preserves the client's choice. It is never a source of facts.
export function articleContract(selection) {
  if (selection == null) return null;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) problem('文章选项格式不正确');
  const goal = option(selection, 'goal', CONTENT_GOALS[0]);
  const format = option(selection, 'format', CONTENT_FORMATS[0]);
  const tone = option(selection, 'tone', CONTENT_TONES[0]);
  const rawDirection = selection.direction ?? {};
  if (!rawDirection || typeof rawDirection !== 'object' || Array.isArray(rawDirection)) problem('文章方向格式不正确');
  const direction = {
    id:text(rawDirection.id, 80, '文章方向编号'),
    title:text(rawDirection.title, 60, '文章标题'),
    angle:text(rawDirection.angle, 240, '文章方向'),
    reader:text(rawDirection.reader, 120, '目标读者'),
    outline:list(rawDirection.outline, 5, '文章结构'),
    evidenceNeed:list(rawDirection.evidenceNeed, 4, '待核对资料'),
    brief:text(rawDirection.brief, 1200, '方向说明')
  };
  return {
    version:1,
    selection:{goal, format, tone},
    direction,
    requirements:[
      {id:'selected_goal', instruction:GOAL_REQUIREMENTS[LEGACY_GOALS[goal] || goal]},
      ...(FORMAT_REQUIREMENTS[LEGACY_FORMATS[format] || format] || []).map((instruction, index) => ({id:`selected_format_${index + 1}`, instruction})),
      {id:'selected_tone', instruction:TONE_REQUIREMENTS[tone]},
      {id:'selected_direction', instruction:'保留已选方向的目标读者、核心问题和提纲逻辑，可调整小标题措辞；证据不足时收窄表述，不用无关通用模板替换所选文章。'},
      {id:'selected_evidence_gaps', instruction:'evidenceNeed 和 brief 中的待核对项不是已确认事实；从 facts 无法得到支持的内容省略或明确为待核对，不自行补全。'}
    ],
    evidenceBoundary:'选择、提纲、语气与写作目标只决定文章组织方式；事实仍仅来自本次 facts 快照。',
    reviewBoundary:'形式和语气是否适合、事实能否支持每项表述，需要编辑逐项核对；结构检查不代表成稿质量通过。'
  };
}
