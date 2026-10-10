/**
 * The site serves Claude-written HTML reports inside a sandboxed iframe (no same-origin access), so the
 * reports cannot read the site's storage. Many reports remember their language in localStorage, which
 * throws inside such a sandbox. This shim, injected at the top of <head> in the served copy (the original
 * file is never modified), provides an in-memory localStorage and answers language keys with the
 * language requested in the URL (?lang=en|zh). It also opens external links in a new tab.
 */
export const READER_SHIM = `<script data-aim-shim>(function(){
var q=new URLSearchParams(location.search),L=q.get('lang');L=L==='en'||L==='zh'?L:null;
var mem={},real=null;try{real=window.localStorage;real.getItem('__aim')}catch(e){real=null}
var s={getItem:function(k){k=String(k);if(Object.prototype.hasOwnProperty.call(mem,k))return mem[k];if(L&&/lang/i.test(k))return L;if(real){try{return real.getItem(k)}catch(e){}}return null},
setItem:function(k,v){mem[String(k)]=String(v)},removeItem:function(k){delete mem[String(k)]},clear:function(){mem={}},
key:function(i){return Object.keys(mem)[i]||null},get length(){return Object.keys(mem).length}};
try{Object.defineProperty(window,'localStorage',{value:s,configurable:true})}catch(e){}
document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null;if(!a)return;var h=a.getAttribute('href')||'';
if(/^https?:/i.test(h)){a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer')}},true);
})();</script>`;

export function injectReaderShim(html: string): string {
  if (html.includes('data-aim-shim')) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + READER_SHIM + html.slice(head.index + head[0].length);
  const root = /<html[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + READER_SHIM + html.slice(root.index + root[0].length);
  return READER_SHIM + html;
}

/** Plain text of an HTML report for full-text search (scripts, styles and tags removed). */
export function htmlToText(html: string, max = 60000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
