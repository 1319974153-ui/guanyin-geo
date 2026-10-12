export const normalizeSource = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '').trim();

function completeExcerpt(source, value) {
  if(!value)return false;
  const raw=String(source||'').normalize('NFKC'), positions=[], parts=[];
  for(let i=0;i<raw.length;i++)if(!/\s/u.test(raw[i])){positions.push(i);parts.push(raw[i]);}
  const normalized=parts.join('');
  for(let start=normalized.indexOf(value);start!==-1;start=normalized.indexOf(value,start+1)){
    let left=positions[start]-1,right=positions[start+value.length-1]+1;
    while(left>=0&&/[^\S\n\r]/u.test(raw[left]))left--;
    while(right<raw.length&&/[^\S\n\r]/u.test(raw[right]))right++;
    const boundary=c=>!c||/[\n\r。；;！？!?：:"'“”‘’（）()【】\[\]]/u.test(c);
    if(boundary(raw[left])&&boundary(raw[right]))return true;
  }
  return false;
}

export function articleTitle({title = '', text = '', question = '', brand = '', style = ''} = {}) {
  if (String(title).trim()) return String(title).trim().slice(0, 160);
  const heading = String(text).match(/^\s*#\s+(.+)$/m)?.[1];
  if (heading) return heading.replace(/\*\*/g, '').trim().slice(0, 160);
  const topic = String(question).replace(/[？?。！!]+$/u, '').trim();
  return (topic ? `${topic}：${style || '实用指南'}` : `${brand || '产品'}${style || '介绍与常见问答'}`).slice(0, 160);
}

export const sourceHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))))).map(x => x.toString(16).padStart(2, '0')).join('');

export function sourceUrl(source) {
  return String(source || '').match(/https?:\/\/[^\s<>"'）)\]，。；]+/u)?.[0] || '';
}

export async function reviewFact(fact, documents, loadPage, cache, loadDocument) {
  const checkedAt = new Date().toISOString();
  if(fact.status==='已归档'||fact.expiresAt&&Date.parse(fact.expiresAt)<Date.parse(checkedAt)||fact.validFrom&&Date.parse(fact.validFrom)>Date.parse(checkedAt))return {status:'needs_review',checkedAt,kind:'validity',source:fact.source,reason:'事实已归档、未生效或已过期，请先核对有效期。'};
  const url = fact.sourceDocumentId ? null : sourceUrl(fact.source);
  let evidence, kind, source, fingerprint;
  if (url) {
    kind = 'web';
    try {
      if (!cache.has(url)) cache.set(url, loadPage(url));
      const page = await cache.get(url);
      evidence = page.sourceText;
      source = page.url;
      fingerprint = await sourceHash(evidence);
    } catch (error) {
      return {status: 'needs_review', checkedAt, kind, source: url, reason: error.status ? error.message : '网页暂时无法读取，请补充原文后重试。'};
    }
  } else {
    kind = 'document';
    const doc = documents.find(d => d.brandId === fact.brandId && d.id === fact.sourceDocumentId)
      || documents.filter(d => d.brandId === fact.brandId && d.title === fact.source).at(-1);
    if (!doc) return {status: 'needs_review', checkedAt, kind, source: fact.source, reason: '尚未保存这份出处的原文。重新上传同名资料即可批量比对。'};
    if(doc.supersededBy)return {status:'needs_review',checkedAt,kind,source:doc.title,reason:'此出处已有新版本，请核对最新资料，旧摘录不自动恢复确认。'};
    try{const extracted=doc.storage==='r2'&&loadDocument?await loadDocument(doc):{text:doc.text};evidence=extracted.text;if(doc.extraction?.ocr&&!extracted.blocks?.some(b=>b.method!=='ocr'&&completeExcerpt(b.text,normalizeSource(fact.value))))return {status:'needs_review',checkedAt,kind,source:doc.title,reason:'此摘录来自 OCR 识别，需对照原件核对错字、数字与遗漏后人工确认；识别置信度不代表事实可信度。'};}catch(error){return {status:'needs_review',checkedAt,kind,source:doc.title,reason:error.status?error.message:'原文暂时无法读取，请重试。'};}
    source = doc.title;
    fingerprint = await sourceHash(evidence);
  }
  const value = normalizeSource(fact.value), original = normalizeSource(evidence);
  if (!value || value.length < 8 || !completeExcerpt(evidence, value)) {
    return {status: 'needs_review', checkedAt, kind, source, fingerprint, reason: value.length < 8 ? '片段过短，无法作为完整事实自动确认。' : !original ? '没有取得可比对的正文。' : '未找到完整一致的原文，需检查改写、遗漏或出处。'};
  }
  return {status: 'matched', checkedAt, kind, source, fingerprint, quote: fact.value,
    reason: kind === 'web' ? '已在本次读取的网页正文中找到完整原文。' : '已与保存的原文或文档抽取文本逐字比对一致；文件版式与页面内容可打开原文件复核。',
    scope: '核对摘录与出处的一致性，不代表独立验证业务结论。'};
}

export function htmlText(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:p|div|h[1-6]|li|ul|ol|section|article|br|tr|title)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ' ';
    }).replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, n) => ({nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[n.toLowerCase()]))
    .replace(/[^\S\n\r]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}
