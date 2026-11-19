import assert from 'node:assert/strict';
let plugin;
const visited=[];
const entries=[
  {document:{id:'rSmmf',title:'Naruto',englishTitle:'Naruto',synopsis:'A ninja manga',posterMedium:'/static/posters/naruto-medium.avif',releaseYear:1999,authors:['Masashi Kishimoto'] }},
  {document:{id:'rSmmf',title:'Duplicate'}},
  {document:{id:'beta',title:'Beta',poster:'https://cdn.example.com/cover.webp'}}
];
const chapters=[
 {id:'chapter10',number:10,title:'Chapter 10',pageCount:2},
 {id:'chapter1',number:1,title:'Chapter 1',pageCount:3},
 {id:'chapter1',number:1,title:'Duplicate',pageCount:3},
 {id:'chapterhalf',number:1.5,title:'Chapter 1.5',pageCount:2}
];
const pages=[
 {number:2,image:'/static/pages/rSmmf/chapter1/2.webp'},
 {number:0,image:'/static/pages/rSmmf/chapter1/0.webp'},
 {number:1,image:'https://cdn.example.com/1.webp'},
 {number:2,image:'/static/pages/rSmmf/chapter1/2.webp'}
];
globalThis.harbor={
 register(x){plugin=x},
 async http(url,opts){
   visited.push({url,opts});
   let response;
   if(url.includes('/documents/search?'))response={hits:entries};
   else if(url.includes('/allChapters?'))response={chapters};
   else if(url.includes('/read/chapter?'))response={readChapter:{pages}};
   else throw new Error('Unexpected URL '+url);
   return {status:200,body:JSON.stringify(response)};
 }
};
await import('../plugins/manga/atsumaru/index.ts');
assert.equal(plugin.id,'atsumaru');
let browse=await plugin.popular(0);
assert.equal(browse.length,2);
assert.equal(browse[0].cover,'https://cdn.atsu.moe/static/posters/naruto-medium.avif');
assert.equal(visited[0].url.includes('q=*'),true);
let found=await plugin.search('Naruto',20);
assert.equal(found.length,2);
assert.equal(visited[1].url.includes('page=2'),true);
const d=await plugin.detail('rSmmf');
assert.equal(d.title,'Naruto');
assert.equal(d.author,'Masashi Kishimoto');
const c=await plugin.chapters('rSmmf');
assert.deepEqual(c.map(x=>x.chapter),['1','1.5','10']);
assert.equal(c[0].id,'rSmmf::chapter1');
assert.equal(c[0].pages,3);
assert.deepEqual(await plugin.pageUrls(c[0].id),[
 'https://cdn.atsu.moe/static/pages/rSmmf/chapter1/0.webp',
 'https://cdn.example.com/1.webp',
 'https://cdn.atsu.moe/static/pages/rSmmf/chapter1/2.webp'
]);
assert.equal(visited.some(x=>x.url.includes('/manga/rSmmf')),false);
await assert.rejects(plugin.pageUrls('malformed'),/invalid/);
await assert.rejects(plugin.detail('../evil'),/invalid/);
globalThis.harbor.http=async ()=>({status:403,body:''});
await assert.rejects(plugin.search('Naruto',0),/HTTP 403/);
console.log('PASS: Atsumaru provider fixture search, pagination, covers, detail, chapters, pages, errors');
