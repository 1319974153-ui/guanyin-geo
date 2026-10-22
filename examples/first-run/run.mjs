// Offline walkthrough: no network, credentials, database, or real workspace writes.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {importedAnswer} from '../../src/answer-import-core.js';
import {makeReport, reportMarkdown} from '../../src/analytics-core.js';

const fixture = JSON.parse(await readFile(new URL('./sample.json', import.meta.url), 'utf8'));
const clock = new Date(fixture.clock);
const answer = {...importedAnswer(fixture.capture, fixture.brand, fixture.question, clock), id: 'demo-answer'};
const state = {brands:[fixture.brand], questions:[fixture.question], answers:[answer], facts:[], contents:[], competitors:[]};
const report = makeReport(state, fixture.brand.id, {period:'all'}, clock);
const checks = {
  originalTextPreserved: answer.text === fixture.capture.text,
  historicalQuestionPreserved: answer.questionText === fixture.question.history[0].text,
  duplicateCitationsCollapsed: answer.citations.length === 1,
  unknownRecommendationPreserved: answer.recommendationLabeled === false,
  unknownCitationPreserved: answer.citationKnown === false,
  trialMarked: answer.demo === true,
  trialExcludedFromFormalReport: report.metrics.n === 0
};
for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
const sourceSha256 = {};
for (const file of ['answer-import-core.js', 'analytics-core.js']) {
  sourceSha256[file] = createHash('sha256').update(await readFile(new URL('../../src/' + file, import.meta.url))).digest('hex');
}
// Explicit destinations must be new to avoid replacing existing reports.
const out = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), 'guanyin-first-run-'));
if (process.argv[2]) {
  try { await mkdir(out); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.error('输出目录已存在，未覆盖文件。请选择新目录，或省略目录参数：\n' + out);
    process.exit(1);
  }
}
const result = {kind:fixture.kind, notice:fixture.notice, runtime:process.version, sourceSha256, checks, importedAnswers:1, citationCount:answer.citations.length, formalAnswerCount:report.metrics.n, externalAIRequests:0, workspaceWrites:0};
const files = {
  'answer.json': JSON.stringify({notice:fixture.notice, answer}, null, 2) + '\n',
  'checks.json': JSON.stringify(result, null, 2) + '\n',
  'report.md': '# 离线演练导出\n\n' + fixture.notice + '\n\n正式样本数为 0 是预期结果：试用演练不计入正式效果。\n\n' + reportMarkdown(report)
};
for (const [file, content] of Object.entries(files)) await writeFile(join(out, file), content, {flag:'wx'});
console.log('7 项检查通过：导入 1 条构造样本，引用去重为 1 条，正式报告样本为 0。');
console.log('未调用外部 AI，未写入真实工作区。输出目录：\n' + out);
console.log('请打开 answer.json、checks.json 和 report.md 核对结果。');
