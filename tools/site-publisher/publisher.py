#!/usr/bin/env python3
"""Forced-command static publisher. No shell, caller paths, deletion or arbitrary uploads.
Configuration is supplied by the server administrator, never by an SSH request.
"""
import sys, os, json, re, hashlib, html, shutil, fcntl, tempfile
from pathlib import Path
from datetime import datetime, timezone
from email.utils import format_datetime
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

LIMIT = 700000
class Content(HTMLParser):
    tags = set('p br h1 h2 h3 h4 h5 h6 strong em s blockquote ul ol li pre code a img hr table thead tbody tr th td'.split())
    def __init__(self): super().__init__(convert_charrefs=True); self.parts=[]
    def handle_starttag(self, tag, attrs):
        if tag not in self.tags: raise ValueError('不支持的正文标签')
        safe=[]
        for key,value in attrs:
            if key in ('href','src'):
                if not value or re.search(r'[\x00-\x20]',value) or not re.match(r'^(https?://|mailto:|#)',value): raise ValueError('无效正文链接')
                if key=='src' and not value.startswith('https://'): raise ValueError('图片需要 HTTPS')
                safe.append((key,value))
            elif key in ('alt','title'): safe.append((key,value or ''))
            elif key=='class' and re.fullmatch(r'language-[\w-]+',value or ''): safe.append((key,value))
        if tag=='a': safe.append(('rel','noopener noreferrer'))
        if tag=='img': safe.append(('loading','lazy'))
        self.parts.append('<'+tag+''.join(' '+k+'="'+html.escape(v,quote=True)+'"' for k,v in safe)+'>')
    def handle_endtag(self,tag):
        if tag not in self.tags: raise ValueError('不支持的正文标签')
        self.parts.append('</'+tag+'>')
    def handle_data(self,data): self.parts.append(html.escape(data))
    def handle_comment(self,data): pass
    def handle_decl(self,data): raise ValueError('正文不能包含声明')

def digest(data): return hashlib.sha256(data if isinstance(data,bytes) else data.encode()).hexdigest()
def atomic(path,data):
    fd,tmp=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w') as out: out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def hashes(root):
    result={}
    for p in root.rglob('*'):
        if p.is_symlink(): raise ValueError('公开目录包含符号链接，需管理员检查')
        if p.is_file(): result[p.relative_to(root).as_posix()]=digest(p.read_bytes())
    return result

def render(cfg,r):
    title=html.escape(r['title']);url=cfg['site']+'articles/gy-'+r['id']+'.html'
    parser=Content();parser.feed(r['html']);parser.close();body=''.join(parser.parts)
    ld=json.dumps({'@context':'https://schema.org','@type':'Article','headline':r['title'],'url':url,'datePublished':r['created'],'author':{'@type':'Person','name':cfg['author']}},ensure_ascii=False).replace('<','\\u003c')
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | '+html.escape(cfg['author'])+'</title><meta name="robots" content="index,follow"><link rel="canonical" href="'+url+'"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/portfolio.css"><script type="application/ld+json">'+ld+'</script></head><body><header class="site-header"><nav class="nav container"><a href="/">'+html.escape(cfg['author'])+'</a><a href="/articles.html">文章</a><a href="/projects.html">项目</a><a href="/contact.html">联系</a></nav></header><main class="container"><article class="section"><h1>'+title+'</h1><p class="muted">'+html.escape(cfg['author'])+' · '+r['created'][:10]+'</p><div class="post-content">'+body+'</div><p><a href="/articles.html">返回文章列表</a></p></article></main></body></html>'

def execute(cfg,request):
    root=Path(cfg['root']).resolve();store=Path(cfg['store']).resolve();store.mkdir(parents=True,exist_ok=True)
    action=request.get('action')
    if action=='info': return {'site':cfg['site'],'name':cfg['name'],'author':cfg['author'],'protocol':1}
    ident=request.get('id','')
    if not re.fullmatch(r'[a-f0-9]{64}',ident): raise ValueError('任务编号无效')
    path=store/(ident+'.json')
    with (store/'lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        r=json.loads(path.read_text()) if path.exists() else None
        if action=='draft':
            payload=request.get('payload',{})
            title=payload.get('title');body=payload.get('html');fingerprint=payload.get('fingerprint')
            if not isinstance(title,str) or not 1<=len(title)<=300 or not isinstance(body,str) or not 1<=len(body)<=450000 or not re.fullmatch(r'[a-f0-9]{64}',fingerprint or ''): raise ValueError('稿件不完整')
            if r:
                if r['fingerprint']!=fingerprint or r['title']!=title or r['html']!=body: raise ValueError('原任务内容不同，未覆盖')
            else:
                if len(list(store.glob('*.json')))>=1000: raise ValueError('任务存储已达上限')
                r={'id':ident,'fingerprint':fingerprint,'title':title,'html':body,'created':datetime.now(timezone.utc).isoformat(),'state':'draft'}
                page=render(cfg,r);r['pageHash']=digest(page);atomic(path,json.dumps(r,ensure_ascii=False))
        elif action not in ('publish','status'): raise ValueError('操作不受支持')
        if not r: raise ValueError('找不到原稿，不会重新创建')
        relative='articles/gy-'+ident+'.html';url=cfg['site']+relative
        current=(root/'current').resolve(strict=True)
        if current.parent!=root/'releases': raise ValueError('网站发布目录不符合配置')
        # Recover crash after the atomic switch but before the journal update.
        target=current/relative
        if target.exists():
            if digest(target.read_bytes())!=r['pageHash']: raise ValueError('线上原稿已变化，未覆盖')
            r['state']='submitted';r['url']=url
            atomic(path,json.dumps(r,ensure_ascii=False))
        if action=='publish' and r['state']=='draft':
            before=hashes(current)
            if relative in before: raise ValueError('目标页面已存在')
            release=Path(tempfile.mkdtemp(prefix='guanyin-',dir=root/'releases'))
            try:
                shutil.copytree(current,release,dirs_exist_ok=True)
                page=render(cfg,r)
                if digest(page)!=r['pageHash']: raise ValueError('模板已变化，请管理员核对原稿')
                (release/'articles').mkdir(exist_ok=True);(release/relative).write_text(page)
                index=release/'articles.html';text=index.read_text();marker='<!-- guanyin-articles -->'
                if marker not in text:
                    end=text.rfind('</main>')
                    if end<0: raise ValueError('文章列表模板无有效入口')
                    text=text[:end]+'<section class="section"><h2>最新发布</h2><ul>'+marker+'</ul></section>'+text[end:]
                text=text.replace(marker,'<li><p>'+r['created'][:10]+'</p><h3><a href="/'+relative+'">'+html.escape(r['title'])+'</a></h3></li>'+marker)
                index.write_text(text)
                sm=release/'sitemap.xml';tree=ET.fromstring(sm.read_text());ns='{http://www.sitemaps.org/schemas/sitemap/0.9}'
                if tree.tag!=ns+'urlset': raise ValueError('站点地图格式不兼容')
                ET.register_namespace('',ns[1:-1]);node=ET.SubElement(tree,ns+'url');ET.SubElement(node,ns+'loc').text=url;ET.SubElement(node,ns+'lastmod').text=r['created'][:10];sm.write_bytes(ET.tostring(tree,encoding='utf-8',xml_declaration=True))
                feed=release/'feed.xml';rss=ET.fromstring(feed.read_text());channel=rss.find('channel')
                if channel is None: raise ValueError('RSS格式不兼容')
                item=ET.Element('item');ET.SubElement(item,'title').text=r['title'];ET.SubElement(item,'link').text=url;ET.SubElement(item,'guid',{'isPermaLink':'true'}).text=url;ET.SubElement(item,'pubDate').text=format_datetime(datetime.fromisoformat(r['created']));channel.insert(0,item);feed.write_bytes(ET.tostring(rss,encoding='utf-8',xml_declaration=True))
                allowed={relative,'articles.html','sitemap.xml','feed.xml'};after=hashes(release)
                if any(after.get(p)!=v for p,v in before.items() if p not in allowed) or set(after)-set(before)-allowed: raise ValueError('出现非授权文件变更')
                if (root/'current').resolve()!=current or hashes(current)!=before: raise ValueError('网站被其他发布更新，请核对原任务')
                os.chmod(release,0o755)
                for p in release.rglob('*'): os.chmod(p,0o755 if p.is_dir() else 0o644)
                link=root/('current-'+ident);link.symlink_to(release);os.replace(link,root/'current')
                r.update(state='submitted',url=url,release=release.name,previous=current.name,files={p:after[p] for p in allowed},preserved=len(before)-3)
                atomic(path,json.dumps(r,ensure_ascii=False))
            except Exception:
                if (root/'current').resolve()!=release: shutil.rmtree(release)
                raise
        return {k:r[k] for k in ('id','fingerprint','state','pageHash','url','files','preserved','previous','release') if k in r}

def main():
    cfg=json.loads(Path('/etc/guanyin-site-publisher.json').read_text())
    data=sys.stdin.buffer.read(LIMIT+1)
    if len(data)>LIMIT: raise ValueError('请求过大')
    print(json.dumps({'result':execute(cfg,json.loads(data))},ensure_ascii=False))
if __name__=='__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'error':str(e) if isinstance(e,ValueError) else '网站处理失败，核对原任务或服务器日志'},ensure_ascii=False));sys.exit(1)
