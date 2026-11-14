import test from 'node:test';
import assert from 'node:assert/strict';
import {articleContract} from '../src/article-contract.js';
import {writingRequest, reviewWritingOutput} from '../src/writing.js';
import {contentDirectionRequest, parseContentDirections} from '../src/content-conversation.js';
import {WRITING_CHOICES, LEGACY_WRITING_CHOICES} from '../src/content-options.js';

function direction(overrides = {}) {
  return {id:'direction-2', title:'了解适合自己的选择', angle:'从已知资料了解适用条件', reader:'第一次了解当前品牌的读者', outline:['先回答适合谁','介绍相关事实与条件','说明核对方法'], evidenceNeed:['核对现有材料未说明的使用结果'], brief:'根据已确认资料说明适用条件，未记录的结果不补写。', ...overrides};
}

test('a selected consumer article keeps its type and outline despite a name-free goal and discovery rotation', () => {
  const selection = {goal:'提升品牌认知', format:'品牌介绍', tone:'通俗易懂', direction:direction({title:'家庭聚餐前怎样了解这家餐厅？'})};
  const request = writingRequest({brand:{name:'测试餐饮品牌', goalQuery:'本地家庭聚餐有哪些餐厅？'}, question:'家庭聚餐前应了解什么？', facts:[{id:'menu', value:'菜单包含多人套餐', source:'菜单'}], contentSelection:selection, variant:3});
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.writingStrategy.mode, 'selected_article');
  assert.deepEqual(input.writingStrategy.sections, selection.direction.outline);
  assert.equal(input.writingStrategy.candidatePositioning, undefined);
  assert.equal(input.writingStrategy.angle.id, 'selected-direction');
  assert.equal(input.goalQuery, '本地家庭聚餐有哪些餐厅？');
  assert.equal(input.articleContract.selection.format, '品牌介绍');
  assert.equal(input.articleContract.direction.reader, selection.direction.reader);
  assert.deepEqual(input.articleContract, request.basis.articleContract);
  assert.match(request.messages[0].content, /优先于旧的 writingStrategy 轮换角度/);
  assert.match(request.messages[0].content, /不得改写成通用技术交付/);
  selection.direction.outline[0] = '后来修改';
  selection.direction.evidenceNeed[0] = '后来修改';
  assert.equal(request.basis.articleContract.direction.outline[0], '先回答适合谁');
  assert.equal(request.basis.articleContract.direction.evidenceNeed[0], '核对现有材料未说明的使用结果');
});

test('the planner and writer share concrete composition requirements for every current type and goal', () => {
  for (const format of WRITING_CHOICES.format) {
    for (const goal of WRITING_CHOICES.goal) {
      const selection = {goal, format, tone:'生动有趣'};
      const planner = contentDirectionRequest({brand:{name:'测试品牌'}, question:'这项选择适合哪些人？', facts:[{id:'f1', value:'资料中已有适用条件', source:'说明'}], ...selection});
      const writer = writingRequest({brand:{name:'测试品牌'}, question:'这项选择适合哪些人？', facts:[], contentSelection:{...selection, direction:direction()}});
      const planningInput = JSON.parse(planner.messages[1].content);
      assert.deepEqual(planningInput.articleContract.selection, selection);
      assert.deepEqual(planningInput.articleContract.requirements, writer.basis.articleContract.requirements);
      assert.ok(planningInput.articleContract.requirements.every(item => item.instruction && item.id));
    }
  }
});

test('six materially different brand fixtures keep their own facts and a chosen consumer or professional form', () => {
  // Synthetic materials only: these exercise routing and evidence boundaries, not generated prose quality.
  const fixtures = [
    {name:'测试护肤品牌', format:'产品或服务介绍', question:'如何了解保湿产品的配方与适用条件？', value:'产品标签记载配方含甘油，适用条件以包装为准'},
    {name:'测试餐饮门店', format:'品牌介绍', question:'家庭聚餐前应查看哪些信息？', value:'菜单提供多人套餐，价格以当日菜单为准'},
    {name:'测试摄影师', format:'案例故事', question:'如何了解摄影师的纪实作品？', value:'作品集有一组经公开授权的人物摄影，无客户效果记录'},
    {name:'测试日程软件', format:'常见问答', question:'共享日历支持哪些安排？', value:'产品说明支持日程提醒，尚无多人并发测试结果'},
    {name:'测试零件制造商', format:'对比指南', question:'怎样判断零件规格是否匹配？', value:'目录记载型号和尺寸，未提供竞品规格或寿命比较'},
    {name:'测试家政服务', format:'知识科普', question:'首次预约保洁应了解什么？', value:'服务说明列出预约时间及清洁范围，无客户满意度统计'}
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const fact = {id:`fixture-${index}`, key:'资料范围', value:fixture.value, source:'隔离测试材料'};
    const request = writingRequest({brand:{name:fixture.name, goalQuery:fixture.question}, question:fixture.question, facts:[fact], contentSelection:{goal:'建立信任', format:fixture.format, tone:'专业清晰', direction:direction()}, variant:3});
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.brand, fixture.name);
    assert.equal(input.question, fixture.question);
    assert.equal(input.facts[0].value, fixture.value);
    assert.equal(input.articleContract.selection.format, fixture.format);
    assert.equal(input.writingStrategy.mode, 'selected_article');
    assert.ok(!input.writingStrategy.sections.includes('拆解从需求到交付的关键步骤'));
    assert.equal(input.facts.length, 1);
  }
});

test('case, comparison and lively prose explicitly retain evidence gaps instead of treating a desired narrative as proof', () => {
  const caseContract = articleContract({format:'案例故事', tone:'生动有趣', direction:direction({evidenceNeed:['实际用户与案例结果均未提供'], brief:'想突出服务后的变化，但不能补造结果'})});
  assert.match(caseContract.requirements.find(item => item.id === 'selected_format_2').instruction, /没有实际案例材料时收窄/);
  assert.match(caseContract.requirements.find(item => item.id === 'selected_tone').instruction, /不得补造/);
  assert.match(caseContract.requirements.find(item => item.id === 'selected_evidence_gaps').instruction, /不是已确认事实/);
  assert.deepEqual(caseContract.direction.evidenceNeed, ['实际用户与案例结果均未提供']);
  const comparison = articleContract({format:'对比指南'});
  assert.match(comparison.requirements.find(item => item.id === 'selected_format_2').instruction, /没有可比对象的资料/);
  assert.match(comparison.requirements.find(item => item.id === 'selected_format_2').instruction, /不强行制造对照表或分数/);
});

test('AI recommended composition remains a choice of prose, not a claimed recommendation of the brand', () => {
  const contract = articleContract({direction:direction({brief:'选用问答形式和通俗语气，资料只有基础使用条件，不适合展开成功案例。'})});
  assert.deepEqual(contract.selection, {goal:'提升品牌认知', format:'AI 推荐', tone:'AI 推荐'});
  assert.match(contract.direction.brief, /资料只有基础使用条件/);
  assert.match(contract.requirements.find(item => item.id === 'selected_format_1').instruction, /不把“AI 推荐”写成品牌已被模型推荐的事实/);
});

test('historical selections are recorded unchanged and requests without selections retain the original rotation', () => {
  for (const [key, values] of Object.entries(LEGACY_WRITING_CHOICES)) {
    for (const value of values) {
      const contract = articleContract({[key]:value});
      assert.equal(contract.selection[key], value);
      assert.ok(contract.requirements.every(item => item.instruction));
    }
  }
  const request = writingRequest({brand:{name:'旧品牌', goalQuery:'怎样判断资料是否匹配？'}, question:'如何比较？', facts:[], variant:2});
  assert.equal(request.basis.articleContract, undefined);
  assert.equal(request.basis.writingStrategy.angle.id, 'evidence-case');
});

test('malformed selections are rejected and a missing selection does not add an implicit one', () => {
  assert.equal(articleContract(), null);
  for (const selection of [[], '品牌介绍', {format:'保证行业第一'}, {tone:{value:'专业清晰'}}, {direction:[]}, {direction:{outline:'标题'}}, {direction:{reader:'x'.repeat(121)}}]) {
    assert.throws(() => articleContract(selection), error => error.status === 400);
  }
});

test('output review retains type-specific editorial requirements without scoring semantic correctness or granting approval', () => {
  const contract = articleContract({goal:'建立信任', format:'案例故事', tone:'生动有趣', direction:direction({evidenceNeed:['缺少案例结果证明']})});
  const review = reviewWritingOutput('# 一次成功故事\n\n没有依据的结果断言也不能因格式正确而自动通过。\n\n本文包含 AI 辅助创作', {facts:[{id:'f1',source:'产品说明'}], articleContract:contract});
  assert.equal(review.status, 'needs_editor_review');
  assert.equal(review.automatedFactVerification, false);
  assert.ok(review.checks.every(check => check.ok));
  assert.deepEqual(review.editorialContract.selection, contract.selection);
  assert.deepEqual(review.editorialContract.evidenceNeed, ['缺少案例结果证明']);
  assert.match(review.editorialContract.boundary, /结构检查不代表成稿质量通过/);
  assert.ok(review.requiredEditorialChecks.includes('selected_format_2'));
  assert.equal(review.score, undefined);
  const legacy = reviewWritingOutput('# 旧稿\n\n正文。');
  assert.equal(legacy.editorialContract, undefined);
});

test('parsed directions feed their intact reader, evidence needs and outline to the writing contract', () => {
  const raw = {directions:Array.from({length:4}, (_, index) => direction({title:`标题 ${index + 1}`, angle:`问题角度 ${index + 1}`}))};
  const parsed = parseContentDirections(JSON.stringify(raw), {format:'品牌介绍'});
  const contract = articleContract({format:'品牌介绍', direction:parsed[2]});
  assert.equal(contract.direction.id, 'direction-3');
  assert.deepEqual(contract.direction.outline, parsed[2].outline);
  assert.equal(contract.direction.reader, parsed[2].reader);
  assert.deepEqual(contract.direction.evidenceNeed, parsed[2].evidenceNeed);
});
