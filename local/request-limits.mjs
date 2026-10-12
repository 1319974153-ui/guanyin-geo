export function localRequestLimit(url){
 const path=new URL(url||'/', 'http://localhost').pathname;
 if(path==='/api/documents/upload')return 10_000_000;
 if(path==='/api/wordpress/media/upload')return 8*1024*1024+200000;
 return 1_100_000;
}
