import unittest,tempfile,json,hashlib,concurrent.futures
from pathlib import Path
from publisher import execute,hashes
class PublishTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);release=self.root/'releases'/'base';release.mkdir(parents=True);(release/'articles').mkdir();(release/'index.html').write_text('首页不变');(release/'articles.html').write_text('<main>旧文章</main>');(release/'sitemap.xml').write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site.test/</loc></url></urlset>');(release/'feed.xml').write_text('<rss><channel><title>文章</title><item><title>旧文章</title></item></channel></rss>');(self.root/'current').symlink_to(release);self.cfg={'root':str(self.root),'store':str(self.root/'private'),'site':'https://site.test/','name':'官网','author':'测试作者'};self.ident='a'*64;self.payload={'title':'安全测试 <script>','html':'<p>正文 &amp; 资料</p>','fingerprint':'b'*64}
 def tearDown(self): self.tmp.cleanup()
 def req(self,action,**kwargs):return execute(self.cfg,{'action':action,'id':self.ident,**kwargs})
 def test_draft_private_publish_atomic_and_idempotent(self):
  original=(self.root/'current').resolve();before=hashes(original);r=self.req('draft',payload=self.payload);self.assertEqual(r['state'],'draft');self.assertEqual(hashes(original),before);r=self.req('publish');self.assertEqual(r['state'],'submitted');self.assertEqual(len(r['files']),4);new=(self.root/'current').resolve();self.assertEqual((new/'index.html').read_text(),'首页不变');self.assertIn('旧文章',(new/'articles.html').read_text());self.assertIn('&lt;script&gt;',(new/('articles/gy-'+self.ident+'.html')).read_text());self.req('publish');self.assertEqual((self.root/'current').resolve(),new)
 def test_reject_paths_and_scripts(self):
  with self.assertRaises(ValueError):execute(self.cfg,{'action':'publish','id':'../../etc/passwd'})
  for html in ['<script>alert(1)</script>','<a href="javascript:alert(1)">x</a>','<iframe src="https://x/">']:
   with self.assertRaises(ValueError):self.req('draft',payload={**self.payload,'html':html})
  self.assertFalse(list((self.root/'private').glob('*.json')))
 def test_changed_remote_content_and_payload_refuse_overwrite(self):
  self.req('draft',payload=self.payload)
  with self.assertRaises(ValueError):self.req('draft',payload={**self.payload,'title':'different'})
  self.req('publish');target=(self.root/'current')/('articles/gy-'+self.ident+'.html');target.write_text('外部修改')
  with self.assertRaises(ValueError):self.req('publish')
  self.assertEqual(target.read_text(),'外部修改')
 def test_recovery_after_atomic_switch(self):
  self.req('draft',payload=self.payload);job=self.root/'private'/(self.ident+'.json');old=job.read_text();self.req('publish');new=(self.root/'current').resolve();job.write_text(old);self.assertEqual(self.req('status')['state'],'submitted');self.req('publish');self.assertEqual((self.root/'current').resolve(),new)
 def test_concurrent_publish_serializes(self):
  self.req('draft',payload=self.payload)
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:self.req('publish'),range(4)))
  self.assertTrue(all(r['state']=='submitted' for r in results));self.assertEqual(len(list((self.root/'releases').glob('guanyin-*'))),1)
if __name__=='__main__':unittest.main()
