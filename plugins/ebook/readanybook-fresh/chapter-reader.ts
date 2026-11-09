import type { EBookChapter } from '../../../shared/types/ebook.js';
export type Item = { href: string; type: string; properties: string };
type Target = { url: string; fragment: string; title: string };
type Indexed = { body: string; anchors: Record<string, number> };
type Range = { url: string; start: number; end: number };
type Group = { title: string; ranges: Range[] };
export type Reader = { chapters: EBookChapter[]; read: (id: string) => Promise<string>; mode: string };
export async function createReader(bookId: string, urls: string[], base: string, xml: string, items: Map<string, Item>, spine: string, get: (url: string, timeout?: number) => Promise<string>, resolve: (base: string, relative: string) => string, attr: (tag: string, key: string) => string): Promise<Reader> {
  const allowed = new Set(urls), names = new Map<string, string>(), cache = new Map<string, Indexed>();
  const targets: Target[] = [];
  const preliminaryNames = new Map<string,string>();
  let invalid = false, size = 0;
  const clean = (s: string) => s.replace(/\s+/g,' ').trim().slice(0,240);
  const target = (dir: string, href: string, current: string) => {
    const split = href.indexOf('#');
    const path = split < 0 ? href : href.slice(0,split);
    return { url: path ? resolve(dir,path) : current, fragment: split < 0 ? '' : decodeURIComponent(href.slice(split+1)) };
  };
  const record = (dir: string, href: string, title: string, current: string) => {
    try { const t = target(dir,href,current); const name = clean(title); if (!allowed.has(t.url) || !name) { invalid = true; return; } targets.push({...t,title:name}); if (!names.has(t.url)) names.set(t.url,name); } catch { invalid = true; }
  };
  const nav = Array.from(items.values()).find(i => i.properties.split(/\s+/).includes('nav'));
  if (nav) {
    try {
      const url = resolve(base,nav.href), dir = url.slice(0,url.lastIndexOf('/')+1);
      const doc = await harbor.parseHtml(await get(url,6000));
      const root = doc.querySelectorAll('nav').find(n => (n.attr('epub:type') || '').split(/\s+/).includes('toc') || n.attr('role') === 'doc-toc');
      for (const a of root?.querySelectorAll('a[href]') || []) record(dir,a.attr('href') || '',a.text(),url);
    } catch { invalid = true; }
  }
  if (!targets.length) {
    invalid = false;
    const ncxId = attr(spine.match(/<spine\b[^>]*>/i)?.[0] || '', 'toc');
    const ncx = items.get(ncxId) || Array.from(items.values()).find(i => i.type === 'application/x-dtbncx+xml');
    if (ncx) {
      try {
        const url = resolve(base,ncx.href), dir = url.slice(0,url.lastIndexOf('/')+1);
        const source = await get(url,6000), stack: string[] = [];
        for (const token of source.match(/<navPoint\b[^>]*>|<\/navPoint\s*>|<navLabel\b[^>]*>[\s\S]*?<\/navLabel\s*>|<content\b[^>]*>/gi) || []) {
          if (/^<navPoint\b/i.test(token)) stack.push('');
          else if (/^<\/navPoint/i.test(token)) stack.pop();
          else if (stack.length && /^<navLabel\b/i.test(token)) stack[stack.length-1] = (await harbor.parseHtml('<p>'+token.replace(/<[^>]*>/g,'')+'</p>')).querySelector('p')?.text() || '';
          else if (stack.length) record(dir,attr(token,'src'),stack[stack.length-1],url);
        }
      } catch { invalid = true; }
    }
  }
  for (const tag of (/<guide\b[^>]*>([\s\S]*?)<\/guide>/i.exec(xml)?.[1] || '').match(/<reference\b[^>]*>/gi) || []) {
    try { const url = resolve(base,attr(tag,'href')); const title = attr(tag,'title') || ({cover:'Cover','title-page':'Title page',copyright:'Copyright',toc:'Contents',dedication:'Dedication'} as Record<string,string>)[attr(tag,'type')]; if (title && allowed.has(url)) { preliminaryNames.set(url,clean(title)); if (!names.has(url)) names.set(url,clean(title)); } } catch {}
  }
  async function indexed(url: string): Promise<Indexed> {
    if (!allowed.has(url)) throw new Error('Non-spine document');
    if (cache.has(url)) return cache.get(url)!;
    const source = await get(url,6000), body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1];
    if (body === undefined) throw new Error('Missing source body');
    size += body.length; if (size > 4000000) throw new Error('Range indexing size limit');
    const anchors: Record<string, number> = Object.create(null);
    const masked = body.replace(/<!--[\s\S]*?-->|<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,s=>' '.repeat(s.length));
    for (const tag of masked.matchAll(/<[a-zA-Z](?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
      for (const a of tag[0].matchAll(/(?:^|\s)(id|xml:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        if (a[1].toLowerCase()==='name' && !/^<a(?:\s|>)/i.test(tag[0])) continue;
        const id = (a[2] ?? a[3] ?? '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
        if (!id) continue;
        if (Object.hasOwn(anchors,id) && anchors[id] !== tag.index) throw new Error('Ambiguous duplicate anchor');
        anchors[id] = tag.index;
      }
    }
    const result = {body,anchors}; cache.set(url,result); return result;
  }
  let groups: Group[] = [], mode = 'Source sections: navigation unavailable';
  if (targets.length && !invalid && urls.length <= 60 && allowed.size === urls.length) {
    try {
      const deadline = Date.now()+18000;
      let next=0;
      await Promise.all(Array.from({length:Math.min(3,urls.length)},async()=>{while(next<urls.length){if(Date.now()>deadline) throw new Error('Indexing time limit'); await indexed(urls[next++]);}}));
      const starts=[0]; for(const url of urls) starts.push(starts[starts.length-1]+cache.get(url)!.body.length);
      const cuts: Array<{pos: number; title: string}>=[]; let previous=-1;
      for(const t of targets){const file=urls.indexOf(t.url), doc=cache.get(t.url)!; const offset=t.fragment?doc.anchors[t.fragment]:0; if(!Number.isSafeInteger(offset)||offset<0||offset>=doc.body.length) throw new Error('Unresolved navigation anchor'); const pos=starts[file]+offset; if(pos<previous) throw new Error('Navigation conflicts with reading order'); if(pos===previous) continue; cuts.push({pos,title:t.title});previous=pos;}
      const ranges=(start: number,end: number): Range[]=>urls.flatMap((url,file)=>{const from=Math.max(start,starts[file]),to=Math.min(end,starts[file+1]);return to>from?[{url,start:from-starts[file],end:to-starts[file]}]:[];});
      for(let i=0;i<urls.length && starts[i]<cuts[0].pos;i++){const end=Math.min(cuts[0].pos,starts[i+1]);if(end>starts[i]) groups.push({title:preliminaryNames.get(urls[i]) || 'Preliminary section '+(i+1),ranges:ranges(starts[i],end)});}
      for(let i=0;i<cuts.length;i++) groups.push({title:cuts[i].title,ranges:ranges(cuts[i].pos,i+1<cuts.length?cuts[i+1].pos:starts[urls.length])});
      mode='Navigation chapter ranges';
    } catch(e) {groups=[];mode='Source sections: '+String(e);}
  } else if (targets.length) mode='Source sections: navigation unsafe or indexing limit';
  if (!groups.length) {
    let next=0;
    const missing=urls.filter(url=>!names.has(url)).slice(0,12);
    await Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{while(next<missing.length){const url=missing[next++];try{const d=await indexed(url);const parsed=await harbor.parseHtml('<html><body>'+d.body+'</body></html>');const heading=parsed.querySelector('body h1, body h2, body h3, body h4, body h5, body h6')?.text();if(heading&&clean(heading)) names.set(url,clean(heading));}catch{}}}));
    groups=urls.map((url,index)=>({title:names.get(url)||'Untitled section '+(index+1),ranges:[{url,start:0,end:-1}]}));
  }
  const counts=new Map<string,number>(); for(const g of groups) counts.set(g.title,(counts.get(g.title)||0)+1);
  const chapters=groups.map((g,index)=>({id:bookId+'|ranges-v1|'+index,title:g.title+((counts.get(g.title)||0)>1?' (entry '+(index+1)+')':''),position:index}));
  async function read(id: string): Promise<string> {
    const index=chapters.findIndex(c=>c.id===id);
    const legacy=urls.find(url=>bookId+'|'+url===id);
    if(index<0&&!legacy) throw new Error('Unknown chapter route');
    const parts=index>=0?groups[index].ranges:[{url:legacy!,start:0,end:-1}];
    const text=[];
    for(const part of parts){
      let body;
      if(cache.has(part.url)) body=cache.get(part.url)!.body;
      else {const source=await get(part.url,15000);body=/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1];}
      if(body===undefined) throw new Error('Missing chapter body');
      const end=part.end<0?body.length:part.end;
      if(part.start<0||end>body.length||part.start>end) throw new Error('Invalid chapter range');
      const fragment=body.slice(part.start,end).replace(/(<(?:p|div|h[1-6]|li|blockquote|pre|section)\b[^>]*>)/gi,'\n\n$1').replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|section)\s*>/gi,'$&\n\n');
      const parsed=await harbor.parseHtml('<html><body>'+fragment+'</body></html>');
      const prose=parsed.querySelector('body')?.text().trim(); if(prose) text.push(prose);
    }
    if(!text.length) throw new Error('No readable chapter text');return text.join('\n\n');
  }
  return {chapters,read,mode};
}
