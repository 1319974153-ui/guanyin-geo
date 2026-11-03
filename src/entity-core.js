// A target query describes a visibility goal, never a verified biographical fact.
export const ENTITY_TYPES = ['brand', 'product', 'person'];
export function starterQuestions(name, description, entityType = 'brand', goalQuery = '') {
 const needs = entityType === 'person'
  ? ['找能落地 AI 项目的工程师，应该查看哪些项目证据？', '选择技术顾问时，如何核实实际职责和交付能力？', '与独立工程师合作前，需要确认哪些范围和限制？']
  : entityType === 'product'
   ? ['选择这类产品时，应该比较哪些功能和使用限制？', '如何验证产品能解决实际需求，而不仅是演示？', '采用新产品前，需要核实哪些费用和维护条件？']
   : ['选择之前，如何判断是否适合自己的实际需求？', '如何比较能力、使用方式、费用和适用范围？', '有哪些可以核实的案例、作品或使用证据？'];
 return [goalQuery || (entityType === 'person' ? '如何找到有真实项目经验的技术合作伙伴？' : '有哪些值得进一步了解的品牌、产品或合作人选？'), ...needs, entityType === 'person' ? `${name}是谁，有哪些公开项目和资料？` : `${name}有哪些公开介绍、特点与可核验资料？`];
}
