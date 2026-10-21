const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hasCover=i=>i&&i.cover&&(i.cover_src==='r18'||i.cover_src==='dmm');
const names=i=>(i.actresses&&i.actresses.length?i.actresses.map(a=>a.name):i.actresses_list||[]);
const short=(s,n=36)=>{s=String(s||'');return s.length>n?s.slice(0,n)+'…':s};
/** Root-relative asset URL. strips query for thumbs. */
function absPath(path){
  if(!path)return'';
  let p=String(path).split('?')[0];
  if(p.startsWith('/'))return p;
  return '/'+p.replace(/^\.\//,'');
}
/** List/card thumbnail: covers/X.jpg?v= → /thumbs/X.jpg ; samples → /thumbs/samples/... */
function thumb(path){
  if(!path)return'';
  let p=String(path).split('?')[0].replace(/^\.\//,'').replace(/^\//,'');
  if(p.startsWith('covers/'))return '/thumbs/'+p.slice('covers/'.length);
  if(p.startsWith('samples/'))return '/thumbs/samples/'+p.slice('samples/'.length);
  if(p.startsWith('thumbs/'))return '/'+p;
  return '/'+p;
}
/** Full-size for detail gallery */
function full(path){
  if(!path)return'';
  const q=String(path).includes('?')?'?'+String(path).split('?')[1]:'';
  let p=String(path).split('?')[0].replace(/^\.\//,'').replace(/^\//,'');
  return '/'+p+q;
}
function imgTag(src,extra='',fb=''){
  if(!src)return'';
  const load=/loading=/.test(extra)?'':'loading="lazy"';
  const err=fb
    ?`onerror="this.onerror=null;this.src='${esc(fb)}';this.removeAttribute('data-fb')"`
    :`onerror="this.onerror=null;this.classList.add('broken');this.removeAttribute('src')"`;
  return nz(`<img ${load} decoding="async" src="${esc(src)}" alt="" ${err} ${extra}>`);
}
/** NSFW: every work image is blurred + labelled until tapped once (per image, per page view). */
const nz=(img,cls='')=>`<span class="nz${cls?' '+cls:''}">${img}<b class="nzl">NSFW<small>点击查看</small></b></span>`;
function setupNsfw(){
  let x0=0,y0=0,moved=false;
  const down=e=>{const t=e.touches?e.touches[0]:e;x0=t.clientX;y0=t.clientY;moved=false};
  const mv=e=>{const t=e.touches?e.touches[0]:e;if(Math.abs(t.clientX-x0)>10||Math.abs(t.clientY-y0)>10)moved=true};
  document.addEventListener('touchstart',down,{passive:true,capture:true});
  document.addEventListener('touchmove',mv,{passive:true,capture:true});
  document.addEventListener('mousedown',down,true);
  document.addEventListener('mousemove',e=>{if(e.buttons)mv(e)},true);
  document.addEventListener('click',e=>{
    const z=e.target&&e.target.closest&&e.target.closest('.nz:not(.on)');
    if(!z||moved)return;
    if(e.target.closest('button[data-fav],button[data-disl],.slide-del,.dthumb'))return;
    e.preventDefault();e.stopPropagation();
    z.classList.add('on');
    const k=z.dataset.k;if(k!=null)$$(`.nz[data-k="${k}"]`).forEach(x=>x.classList.add('on'));
  },true);
}

let hotWeek=null,items=[],favs=[],samplesMap={},timer,homeTab='rec',retHash='#/',favShown={},driveCfg={url:'https://drive.google.com/drive/folders/15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl',folderId:'15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl',folderName:'番号截图'};
const viewStore=new Map(); // hashKey -> {frag, scrollY, homeTab, galCtl}
let lastViewKey=null;
function viewKey(h){
  h=h||'#/';
  if(h==='#'||h===''||h==='#/'){
    const q=($('#q')&&$('#q').value||'').trim();
    return q?'#/?q='+encodeURIComponent(q):'#/';
  }
  return h;
}
function tabFor(h){
  h=h||'#/';
  if(/^#\/login/.test(h))return'login';
  if(/^#\/register/.test(h))return'register';
  if(h.startsWith('#/following'))return'follow';
  if(h.startsWith('#/offline'))return'offline';
  if(h.startsWith('#/me'))return'me';
  return'home';
}
function bumpView(key){if(key)viewStore.delete(key)}
function saveView(key){
  if(!key||/^#\/(login|register)/.test(key))return;
  const appEl=$('#app');if(!appEl||!appEl.childNodes.length)return;
  const frag=document.createDocumentFragment();
  while(appEl.firstChild)frag.appendChild(appEl.firstChild);
  viewStore.set(key,{frag,scrollY:window.scrollY||0,homeTab,galCtl:_galCtl});
  while(viewStore.size>8){const k=viewStore.keys().next().value;viewStore.delete(k)}
}
function restoreView(key){
  const v=viewStore.get(key);if(!v)return false;
  viewStore.delete(key);
  clearInterval(timer);stopGalAuto();
  const appEl=$('#app');if(!appEl)return false;
  appEl.textContent='';
  appEl.appendChild(v.frag);
  if(v.homeTab!=null)homeTab=v.homeTab;
  _galCtl=v.galCtl||null;
  setTab(tabFor(key.startsWith('#/?q=')?'#/':key));
  chip();
  if($('#car'))initCar();
  if(_galCtl&&_galCtl.resume)_galCtl.resume();
  requestAnimationFrame(()=>scrollTo(0,v.scrollY||0));
  return true;
}

function samplesFor(i){
  if(!i)return[];
  if(i.samples&&i.samples.length)return i.samples;
  return samplesMap[i.code]||[];
}
/* ---------- actress albums (curated favs + on-demand local) ---------- */
const ACTOR_MAP_KEY='jav_actor_map_v1';
function loadActorMap(){try{return JSON.parse(localStorage.getItem(ACTOR_MAP_KEY)||'{}')}catch{return{}}}
function rememberActor(slug,name){
  const m=loadActorMap();m[slug]=name;localStorage.setItem(ACTOR_MAP_KEY,JSON.stringify(m));
}
function actorSlug(name){
  name=String(name||'').trim();
  const hex=[...new TextEncoder().encode(name)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return 'n-'+hex.slice(0,40);
}
function nameMatch(a,b){
  a=String(a||'').trim();b=String(b||'').trim();
  if(!a||!b)return false;
  return a===b||a.includes(b)||b.includes(a);
}
function collectWorksByName(name){
  const out=[],seen=new Set();
  const push=w=>{
    if(!w)return;
    const id=String(w.vid||w.code||'');
    if(!id||seen.has(id))return;
    seen.add(id);out.push(w);
  };
  for(const i of items){
    if(names(i).some(n=>nameMatch(n,name)))push(i);
  }
  for(const f of favs){
    if(nameMatch(f.name,name)||(f.aliases||[]).some(a=>nameMatch(a,name))){
      (f.works||[]).forEach(push);
    }else{
      for(const w of (f.works||[])){
        if(names(w).some(n=>nameMatch(n,name)))push(w);
      }
    }
  }
  out.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0));
  return out;
}
function matchCurated(name){
  return favs.find(f=>nameMatch(f.name,name)||(f.aliases||[]).some(a=>nameMatch(a,name)))||null;
}
function buildActressAlbum(name){
  name=String(name||'').trim();
  if(!name)return null;
  const curated=matchCurated(name);
  if(curated){rememberActor(curated.slug,curated.name);return curated}
  const slug=actorSlug(name);
  rememberActor(slug,name);
  const works=collectWorksByName(name);
  return {slug,name,aliases:[],works,local:true,total:works.length};
}
function resolveActress(slug){
  slug=String(slug||'');
  let f=favs.find(x=>x.slug===slug);
  if(f)return f;
  const map=loadActorMap();
  const name=map[slug];
  if(name)return buildActressAlbum(name);
  if(slug.startsWith('n-')){
    // cannot reverse hex reliably without map
    return null;
  }
  return null;
}
function toast(msg,action){
  let el=$('#jav-toast');
  if(!el){
    el=document.createElement('div');
    el.id='jav-toast';
    el.className='jav-toast';
    document.body.appendChild(el);
  }
  el.textContent=msg;
  el.classList.toggle('act',!!action);
  if(action){
    const b=document.createElement('button');b.type='button';b.className='toast-act';b.textContent=action.label||'撤销';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();el.classList.remove('show');try{action.fn()}catch(_){}};
    el.appendChild(document.createTextNode(' · '));el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>el.classList.remove('show'),action?4500:1600);
}
addEventListener('jav-save-fail',e=>toast('云端同步失败：'+(e.detail||'')));

async function copyText(text){
  text=String(text||'');
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(text);
    else{
      const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
    }
    return true;
  }catch{return false}
}

function gallerySlides(i,userRows){
  const slides=[];
  if(hasCover(i))slides.push({src:full(i.cover),kind:'cover'});
  for(const s of samplesFor(i)){
    const u=full(s);
    if(u&&!slides.some(x=>x.src.split('?')[0]===u.split('?')[0]))slides.push({src:u,kind:'sample'});
  }
  for(const r of (userRows||[])){
    if(!r)continue;
    const src=r.dataUrl||r.src||r.url||'';
    if(!src)continue;
    slides.push({src,kind:'mine',id:r.id,name:r.name||''});
  }
  return slides;
}
function slideHtml(sl,k,code){
  const badge=sl.kind==='mine'?`<span class="mine-badge">我的</span>`:'';
  const del=sl.kind==='mine'?`<button type="button" class="slide-del" data-del="${esc(sl.id)}" aria-label="删除">×</button>`:'';
  return `<div class="dslide" data-kind="${esc(sl.kind)}" ${sl.id?`data-id="${esc(sl.id)}"`:''}>
      ${badge}${del}
      ${nz(`<img loading="${k?'lazy':'eager'}" decoding="async" src="${esc(sl.src)}" alt="${esc(code)} ${k+1}" onerror="this.onerror=null;this.style.opacity=.2">`).replace('<span class="nz"',`<span class="nz" data-k="g${k}"`)}
    </div>`;
}

/* ---------- age gate ---------- */
function setupGate(){
  if(localStorage.age18==='1'){$('#gate')?.remove();return}
  const g=$('#gate');if(!g)return;
  $('#yes').onclick=()=>{localStorage.age18='1';g.remove()};
  $('#no').onclick=()=>location.href='https://www.google.com';
}

/* ---------- helpers ---------- */
function byVid(v){return items.find(x=>String(x.vid)===String(v))||favs.flatMap(f=>f.works).find(x=>String(x.vid)===String(v))}
function actressCover(f){const w=f.works.find(hasCover);return w?thumb(w.cover):''}
function needAuth(hash){
  if(Auth.current()&&Auth.getToken())return false;
  if(/^#\/(login|register)/.test(hash||''))return false;
  retHash=hash&&hash!=='#/login'?hash:'#/';
  location.hash='#/login';return true;
}
function setTab(active){
  $$('#tabbar a').forEach(a=>a.classList.toggle('on',a.dataset.tab===active));
  const hide=['login','register'].includes(active);
  $('#tabbar').style.display=hide?'none':'flex';
  $('#topbar').style.display=hide?'none':'flex';
}
function chip(){
  const u=Auth.current();
  $('#userchip').textContent=u?u:'未登录';
}

/* ---------- cards ---------- */
function vcard(i){
  const L=/^[\w.-]+$/.test(String(i.vid));
  const fav=Auth.isFavorited(i.vid);
  const th=hasCover(i)?imgTag(thumb(i.cover),'',full(i.cover)):`<div class="ph">暂无封面</div>`;
  const main=`<div class="thumb">${th}</div><div class="info"><div class="code">${esc(i.code)}</div><div class="ttl">${esc(i.title)}</div><div class="meta"><span>${esc(i.date||'')}</span><span>${esc(i.studio||'')}</span></div></div>`;
  const star=`<button type="button" class="favbtn ${fav?'on':''}" data-fav="${esc(i.vid)}" aria-label="收藏">${fav?'★':'☆'}</button>`;
  const dis=Auth.isDisliked(i.code);
  // 踩: small corner button, also OUTSIDE <a> (same iOS reason as favbtn)
  const thumbDown=`<button type="button" class="dislbtn ${dis?'on':''}" data-disl="${esc(i.code)}" aria-label="${dis?'取消不感兴趣':'不感兴趣'}" title="${dis?'取消不感兴趣':'不感兴趣·减少此类推荐'}">${dis?'↺':'👎'}</button>`;
  const seen=!dis&&Auth.isViewed(i.code);
  const badge=dis?`<span class="dis-badge">已踩</span>`:(seen?`<span class="dis-badge seen-badge">已看</span>`:'');
  // favbtn must stay OUTSIDE <a> — iOS often navigates the parent link despite preventDefault
  const inner=L?`<a class="vcard-link" href="#/v/${i.vid}">${main}</a>`:main;
  return `<div class="vcard${dis?' is-dis':''}" data-code="${esc(normCode(i.code))}">${inner}${badge}${star}${thumbDown}</div>`;
}
function ahcard(f){
  const c=actressCover(f);
  return`<a class="ahcard" href="#/fav/${f.slug}"><div class="av">${c?imgTag(c):''}</div>
    <div class="nm">${esc(f.name)}${f.kind==='male'?' <span class="mbadge">男优</span>':''}</div>
    <div class="meta">${f.issue?esc(f.issue)+' · ':''}${f.works.length} 部</div></a>`;
}

/* ---------- pages ---------- */
/** One card per 番号: javtext can list a code under several vids. Keep richest, carry hot/match. */
const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function dedupeByCode(arr){
  const best=new Map(),order=[];
  const sc=x=>[hasCover(x)?1:0,x.plot_zh?1:0,(x.actresses||[]).length?1:0,(x.samples||[]).length,(x.genres||[]).length];
  const gt=(a,b)=>{const A=sc(a),B=sc(b);for(let k=0;k<A.length;k++){if(A[k]!==B[k])return A[k]>B[k]}return false};
  for(const it of arr){
    const k=normCode(it.code)||String(it.vid);const o=best.get(k);
    if(!o){best.set(k,it);order.push(k);continue}
    const [w,l]=gt(it,o)?[it,o]:[o,it];
    if(l.hot&&!w.hot)w.hot=l.hot; if(l.match&&!w.match)w.match=l.match;
    best.set(k,w);
  }
  return order.map(k=>best.get(k));
}
/** Partition home sections so 推荐 / 热门 never re-show the same code. */
/* ---------- 踩 / 减少推荐 ---------- */
let _codeMap=null,_codeMapKey='';
function workByCode(k){
  const key=items.length+'/'+favs.length;
  if(!_codeMap||_codeMapKey!==key){
    _codeMap=new Map();_codeMapKey=key;
    for(const w of items){const c=normCode(w.code);if(c&&!_codeMap.has(c))_codeMap.set(c,w)}
    for(const f of favs)for(const w of (f.works||[])){const c=normCode(w.code);if(c&&!_codeMap.has(c))_codeMap.set(c,w)}
  }
  return _codeMap.get(normCode(k))||null;
}
function followedNameFn(){
  const fl=new Set(Auth.follows());
  const names=[];
  for(const f of favs)if(fl.has(f.slug))names.push(f.name,...(f.aliases||[]));
  const map=loadActorMap();
  for(const s of fl)if(map[s])names.push(map[s]);
  const memo=new Map();
  return n=>{
    if(memo.has(n))return memo.get(n);
    const v=fl.has(actorSlug(n))||names.some(x=>nameMatch(x,n));
    memo.set(n,v);return v;
  };
}
function dislikeCtx(){
  const isF=followedNameFn();
  const codes=Auth.dislikes();
  return {dislikes:new Set(codes.map(normCode)),viewed:Auth.viewedSet(),profile:Rank.buildProfile(codes,workByCode,isF),isFollowedName:isF,hasCover};
}
function homeBuckets(heat){
  return Rank.buckets(items,Object.assign(dislikeCtx(),{heat:heat||new Map()}));
}
function pageRecommend(){
  const {carItems,related,newest}=homeBuckets();
  const car=carItems.length?`<div class="car" id="car"><div class="track">${carItems.map((i,k)=>`<a class="slide" data-code="${esc(normCode(i.code))}" href="#/v/${i.vid}">${imgTag(thumb(i.cover),k?'':'loading="eager"',full(i.cover))}<div class="cap"><b>${esc(i.code)}</b>${esc(short(i.title,40))}</div></a>`).join('')}</div><div class="dots">${carItems.map((_,k)=>`<i data-k="${k}"></i>`).join('')}</div></div>`:'';
  const relSec=related.length?`<div class="sec"><div class="sec-h"><h2>关注相关</h2></div><div class="vgrid">${related.map(vcard).join('')}</div></div>`:'';
  return car+relSec+`<div class="sec" data-main="1"><div class="sec-h"><h2>最新上架</h2></div><div class="vgrid">${newest.map(vcard).join('')||emptyHomeHint()}</div></div>`;
}
function pageHot(){
  const heat=new Map();
  favs.forEach(f=>f.works.forEach(w=>{if(w.code)heat.set(w.code,(heat.get(w.code)||0)+Math.min(f.works.length,200))}));
  // whole archive: library + every 精选 work (deduped by 番号), ranked by this week's lists
  const all=dedupeByCode(items.concat(...favs.map(f=>f.works||[])));
  const {week,rest,wscore}=Rank.weekHot(all,Object.assign(dislikeCtx(),{heat,week:(hotWeek&&hotWeek.ranks)||{}}));
  const tag=i=>{const w=wscore(i);return w?`<span class="wk-badge">${esc(w.src.filter(x=>/周/.test(x))[0]||w.src[0]||'')}</span>`:''};
  const wcard=(i,k)=>vcard(i).replace('<div class="thumb">',`<div class="thumb"><span class="wk-rank">${k+1}</span>${tag(i)}`);
  const span=hotWeek&&hotWeek.snapshots&&hotWeek.snapshots.length?`${hotWeek.snapshots[0].slice(5)}~${hotWeek.snapshots[hotWeek.snapshots.length-1].slice(5)}`:'';
  const weekSec=`<div class="sec" data-main="1"><div class="sec-h"><h2>本周热门 · 全库</h2><span class="sec-sub">${hotWeek?`javdb/missav 周榜 ${esc(span)} · ${week.length} 部`:'加载中…'}</span></div><div class="vgrid">${week.map(wcard).join('')||emptyHomeHint()}</div></div>`;
  const restSec=rest.length?`<div class="sec"><div class="sec-h"><h2>更多作品</h2><span class="sec-sub">本周未上榜</span></div><div class="vgrid">${rest.slice(0,30).map(vcard).join('')}</div></div>`:'';
  return weekSec+restSec;
}
function emptyHomeHint(){
  const n=Auth.viewed().length;
  return `<p class="empty">暂无新内容${n?`（看过的 ${n} 部已移到 <a href="#/me/viewed">我的 · 已浏览</a>）`:''}</p>`;
}
/* ---------- 精选 · 按演员归档 ---------- */
let agOpen={};
function featuredGroups({home=false,exclude=null}={}){
  const fl=new Set(Auth.follows());
  const vs=Auth.viewedSet(),dis=new Set(Auth.dislikes().map(normCode));
  const gs=favs.map((f,idx)=>{
    const all=dedupeByCode(f.works||[]);
    let works=all;
    if(home)works=all.filter(w=>{const k=normCode(w.code);return !vs.has(k)&&!dis.has(k)&&!(exclude&&exclude.has(k))});
    return {f,all,works,followed:fl.has(f.slug),idx};
  }).filter(g=>g.works.length);
  // followed first, then by number of works
  gs.sort((a,b)=>(b.followed-a.followed)||((b.f.total||b.all.length)-(a.f.total||a.all.length))||(a.idx-b.idx));
  return gs;
}
function agroupHtml(g,{home=false}={}){
  const f=g.f,c=actressCover(f),slug=f.slug;
  const total=f.total&&f.total>g.all.length?f.total:g.all.length;
  const open=!home&&agOpen[slug];
  const N=home?10:(open?30:12);
  const list=g.works.slice(0,N);
  const left=g.works.length-list.length;
  const cnt=home?`${g.works.length} 部未看${total>g.works.length?` · 共 ${total}`:''}`:`${total} 部${f.issue?' · '+esc(f.issue):''}`;
  const head=`<div class="ag-h"><a class="ag-av" href="#/fav/${esc(slug)}">${c?imgTag(c):''}</a>
    <a class="ag-t" href="#/fav/${esc(slug)}"><div class="nm">${esc(f.name)}${f.kind==='male'?' <span class="mbadge">男优</span>':''}${g.followed?' <span class="ag-fl">已关注</span>':''}</div><div class="meta">${cnt}</div></a>
    ${home?`<a class="ag-all" href="#/fav/${esc(slug)}">专辑 ›</a>`:`<button class="btn btn-sm ${g.followed?'btn-pink':'btn-outline'}" data-follow="${esc(slug)}">${g.followed?'已关注':'关注'}</button>`}</div>`;
  const cards=list.map(vcard).join('');
  const tail=home||!open?(left>0?`<a class="ag-tile" href="#/fav/${esc(slug)}">+${left}<br><span>全部 ›</span></a>`:''):'';
  const body=open?`<div class="vgrid ag-grid">${cards}</div>`:`<div class="hrow">${cards}${tail}</div>`;
  const more=home?'':`<div class="ag-foot">${g.works.length>12?`<button type="button" class="btn btn-sm btn-ghost" data-agmore="${esc(slug)}">${open?'收起':'展开 '+Math.min(30,g.works.length)+' 部'}</button>`:''}${open&&g.works.length>30?` <a class="btn btn-sm btn-outline" href="#/fav/${esc(slug)}">查看全部 ${g.works.length} 部 ›</a>`:''}</div>`;
  return `<div class="agroup" data-slug="${esc(slug)}">${head}${body}${more}</div>`;
}
/** Back on a cached home view: drop cards the user has since opened (no full re-render, keeps scroll). */
function pruneViewedHome(){
  const hb=$('#homebody');if(!hb)return;
  const vs=Auth.viewedSet();let carHit=false;
  hb.querySelectorAll('.vcard[data-code]').forEach(c=>{if(vs.has(c.dataset.code))c.remove()});
  hb.querySelectorAll('#car .slide[data-code]').forEach((sl,k)=>{if(vs.has(sl.dataset.code)){carHit=true;sl.remove()}});
  if(carHit){const car=$('#car');const n=car.querySelectorAll('.slide').length;
    if(!n)car.remove();else{car.querySelector('.dots').innerHTML=Array.from({length:n},(_,k)=>`<i data-k="${k}"></i>`).join('');initCar()}}
  hb.querySelectorAll('.agroup').forEach(g=>{if(!g.querySelector('.vcard'))g.remove()});
  hb.querySelectorAll('.sec').forEach(sec=>{
    if(sec.querySelector('.agroup,.vcard,.empty'))return;
    if(sec.dataset.main){const g=sec.querySelector('.vgrid');if(g)g.innerHTML=emptyHomeHint()}else sec.remove();
  });
}
function home(){
  setTab('home');chip();
  const q=($('#q').value||'').trim().toLowerCase();
  if(q){
    const f=items.filter(i=>[i.code,i.studio,i.title,...names(i)].join(' ').toLowerCase().includes(q));
    $('#app').innerHTML=`<div class="sec"><div class="sec-h"><h2>搜索「${esc(q)}」</h2></div><div class="vgrid">${f.map(vcard).join('')||'<div class="empty"><p>没有匹配结果</p></div>'}</div></div>`;
    bindFavBtns();return;
  }
  $('#app').innerHTML=`<div class="htabs"><a href="#/" data-ht="rec" class="${homeTab==='rec'?'on':''}">推荐</a><a href="#/" data-ht="hot" class="${homeTab==='hot'?'on':''}">热门</a></div>
    <div id="homebody">${homeTab==='hot'?pageHot():pageRecommend()}</div>`;
  $$('.htabs a').forEach(a=>a.onclick=e=>{e.preventDefault();homeTab=a.dataset.ht;bumpView('#/');bumpView(viewKey('#/'));home();lastViewKey=viewKey('#/')});
  if(homeTab==='rec')initCar();
  bindFavBtns();
}
function initCar(){
  clearInterval(timer);stopGalAuto();const car=$('#car');if(!car)return;
  const tr=car.querySelector('.track'),n=tr.children.length,ds=car.querySelectorAll('.dots i');let k=0;
  const go=x=>{k=(x+n)%n;tr.style.transform=`translateX(-${k*100}%)`;ds.forEach((d,j)=>d.classList.toggle('on',j===k))};
  ds.forEach(d=>d.onclick=()=>go(+d.dataset.k));go(0);timer=setInterval(()=>go(k+1),4500);
}
function refreshHome(){
  bumpView('#/');bumpView(viewKey('#/'));
  if(tabFor(location.hash||'#/')==='home'&&!(location.hash||'').startsWith('#/v/')&&!(location.hash||'').startsWith('#/fav')&&$('#homebody')){
    const y=window.scrollY||0;home();lastViewKey=viewKey('#/');requestAnimationFrame(()=>scrollTo(0,y));
  }
}
async function doDislike(code,on,{onUndo}={}){
  try{
    await Auth.setDislike(code,on);
  }catch(err){toast('保存失败：'+(err.message||err));return false}
  bumpView('#/');bumpView(viewKey('#/'));
  if(on)toast('已减少此类推荐',{label:'撤销',fn:async()=>{
    try{await Auth.setDislike(code,false)}catch(err){toast('撤销失败：'+(err.message||err));return}
    toast('已撤销');if(onUndo)onUndo();else refreshHome();
  }});
  else toast('已取消不感兴趣');
  return true;
}
function bindDislikeBtns(){
  $$('[data-disl]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    const code=b.dataset.disl;const card=b.closest('.vcard');
    const on=!Auth.isDisliked(code);
    const inHome=!!(card&&card.closest('#homebody'));
    if(on&&inHome){
      card.classList.add('dis-out');
      setTimeout(()=>{if(card.isConnected)card.remove()},260);
      await doDislike(code,true);
      return;
    }
    const ok=await doDislike(code,on,{onUndo:()=>{if(card&&card.isConnected)card.outerHTML=vcard(workByCode(code)||{code});bindFavBtns()}});
    if(ok&&card&&card.isConnected){const w=workByCode(code);if(w){card.outerHTML=vcard(w);bindFavBtns()}}
  });
}
function bindFavBtns(){
  bindDislikeBtns();
  $$('[data-fav]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    if(!Auth.current()){retHash=location.hash||'#/';location.hash='#/login';return}
    const was=b.classList.contains('on');
    b.classList.toggle('on',!was);b.textContent=!was?'★':'☆';
    try{
      const on=await Auth.toggleFavorite(b.dataset.fav);
      if(!b.isConnected)return;
      b.classList.toggle('on',on);b.textContent=on?'★':'☆';
    }catch(err){if(b.isConnected){b.classList.toggle('on',was);b.textContent=was?'★':'☆'}toast('收藏失败：'+(err.message||err))}
  });
}

function loginPage(isReg){
  setTab(isReg?'register':'login');clearInterval(timer);stopGalAuto();
  $('#app').innerHTML=`<div class="auth">
    <h1>${isReg?'注册账号':'登录'}</h1>
    <p class="sub">${isReg?'创建账号后可关注女优、收藏作品（云端保存，换设备不丢）':'欢迎回来 · 数据保存在云端'}</p>
    <div class="field"><label>用户名</label><input id="au" autocomplete="username" placeholder="至少 2 个字符"></div>
    <div class="field"><label>密码</label><input id="ap" type="password" autocomplete="${isReg?'new-password':'current-password'}" placeholder="至少 4 位"></div>
    <div class="auth-err" id="aerr"></div>
    <button class="btn btn-pink btn-block" id="ago">${isReg?'注册并登录':'登录'}</button>
    <div class="auth-switch">${isReg?'已有账号？ <a href="#/login">去登录</a>':'没有账号？ <a href="#/register">注册</a>'}</div>
  </div>`;
  $('#ago').onclick=async()=>{
    const err=$('#aerr');err.textContent='';
    try{
      if(isReg)await Auth.register($('#au').value,$('#ap').value);
      else await Auth.login($('#au').value,$('#ap').value);
      chip();location.hash=retHash&&retHash!=='#/login'&&retHash!=='#/register'?retHash:'#/';
    }catch(e){err.textContent=e.message||String(e)}
  };
  $('#ap').onkeydown=e=>{if(e.key==='Enter')$('#ago').click()};
}

function followingPage(){
  setTab('follow');clearInterval(timer);stopGalAuto();chip();
  const slugs=Auth.follows();
  const list=slugs.map(s=>resolveActress(s)||favs.find(f=>f.slug===s)).filter(Boolean);
  if(!list.length){
    $('#app').innerHTML=`<div class="empty"><div class="big">👀</div><p>还没有关注的女优</p><p style="font-size:12px">在作品详情页点演员名，或在「我的 · 精选女优」里点「关注」</p><a class="btn btn-pink" href="#/" style="margin-top:16px">去首页看看</a></div>`;
    return;
  }
  $('#app').innerHTML=`<div class="sec"><div class="sec-h"><h2>我的关注</h2><span style="font-size:12px;color:var(--muted)">${list.length} 人</span></div>
    <div class="flist">${list.map(f=>{const c=actressCover(f);return`<a class="fitem" href="#/fav/${f.slug}">
      <div class="av">${c?imgTag(c):''}</div>
      <div class="bd"><div class="nm">${esc(f.name)}${f.kind==='male'?' <span class="mbadge">男优</span>':''}</div>
      <div class="meta">${f.issue?esc(f.issue)+' · ':''}${f.works.length} 部作品</div></div></a>`}).join('')}</div></div>`;
}

function offlinePage(){
  setTab('offline');clearInterval(timer);stopGalAuto();chip();
  $('#app').innerHTML=`<div class="placeholder"><div class="box"><div style="font-size:40px;margin-bottom:8px">📥</div>
    <h2>离线缓存</h2><p>正在开发中 · 以后可在这里查看已缓存的作品</p></div></div>`;
}

function mePage(){
  setTab('me');clearInterval(timer);stopGalAuto();chip();
  const u=Auth.current();
  $('#app').innerHTML=`<div class="me-head"><div class="uname">${esc(u)}</div><div class="hint">数据保存在云端 · 换设备登录同一账号不丢</div></div>
    <div class="me-menu">
      <a href="#/me/favorites"><span>⭐ 收藏夹</span><span class="arr">${Auth.favorites().length} ›</span></a>
      <a href="#/me/viewed"><span>🕘 已浏览</span><span class="arr">${Auth.viewed().length} ›</span></a>
      <a href="#/me/dislikes"><span>👎 不感兴趣</span><span class="arr">${Auth.dislikes().length} ›</span></a>
      <a href="#/fav"><span>❤️ 精选女优</span><span class="arr">›</span></a>
      <a href="#/" id="logout"><span>退出登录</span><span class="arr">›</span></a>
    </div>
    <p class="foot-note" id="upd"></p>`;
  $('#logout').onclick=e=>{e.preventDefault();Auth.logout();chip();location.hash='#/login'};
  const el=$('#upd');if(el)el.textContent=`共 ${items.length} 部公开数据 · 来自 javtext.com`;
}

function meFavorites(){
  setTab('me');clearInterval(timer);stopGalAuto();chip();
  const vids=Auth.favorites();
  const works=vids.map(byVid).filter(Boolean);
  $('#app').innerHTML=`<div class="page"><a class="back" href="#/me">← 我的</a>
    <div class="page-h"><div><h1>收藏夹</h1><div class="sub">${works.length} 部作品</div></div></div>
    ${works.length?`<div class="vgrid">${works.map(vcard).join('')}</div>`:`<div class="empty"><div class="big">☆</div><p>还没有收藏</p><p style="font-size:12px">在作品卡片或详情页点 ☆ 即可收藏</p></div>`}
  </div>`;
  bindFavBtns();
}

function meDislikes(){
  setTab('me');clearInterval(timer);stopGalAuto();chip();
  const codes=Auth.dislikes();
  const row=c=>{const w=workByCode(c);const L=w&&/^[\w.-]+$/.test(String(w.vid));
    const th=w&&hasCover(w)?imgTag(thumb(w.cover),'',full(w.cover)):'<div class="ph">—</div>';
    const body=`<div class="dav">${th}</div><div class="bd"><div class="nm">${esc(w?w.code:c)}</div><div class="meta">${esc(w?short(w.title,40):'（不在当前片库）')}</div><div class="meta">${esc(w?names(w).join(' / '):'')}</div></div>`;
    return `<div class="disitem" data-row="${esc(c)}">${L?`<a class="dlink" href="#/v/${w.vid}">${body}</a>`:`<div class="dlink">${body}</div>`}<button type="button" class="btn btn-sm btn-outline" data-undisl="${esc(c)}">取消</button></div>`};
  $('#app').innerHTML=`<div class="page"><a class="back" href="#/me">← 我的</a>
    <div class="page-h"><div><h1>不感兴趣</h1><div class="sub">${codes.length} 部 · 首页不再出现，同演员/系列/相近标签的作品会靠后</div></div></div>
    ${codes.length?`<div class="dislist">${codes.map(row).join('')}</div>`:`<div class="empty"><div class="big">👍</div><p>还没有踩过的作品</p><p style="font-size:12px">在作品卡片左上角点 👎 或详情页点「不感兴趣」</p></div>`}
  </div>`;
  $$('[data-undisl]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    const c=b.dataset.undisl;b.disabled=true;
    try{await Auth.setDislike(c,false)}catch(err){b.disabled=false;toast('保存失败：'+(err.message||err));return}
    bumpView('#/');bumpView(viewKey('#/'));
    const r=b.closest('.disitem');if(r){r.classList.add('dis-out');setTimeout(()=>{if(r.isConnected)r.remove()},260)}
    const sub=$('.page-h .sub');if(sub)sub.textContent=`${Auth.dislikes().length} 部 · 首页不再出现，同演员/系列/相近标签的作品会靠后`;
    toast(`已取消 ${c}`,{label:'撤销',fn:async()=>{try{await Auth.setDislike(c,true)}catch(_){}bumpView('#/');meDislikes()}});
  });
}

function fmtViewTime(t){
  if(!t)return'';const d=new Date(t),now=new Date();
  const p=n=>String(n).padStart(2,'0');
  const hm=`${p(d.getHours())}:${p(d.getMinutes())}`;
  if(d.toDateString()===now.toDateString())return'今天 '+hm;
  const y=new Date(now);y.setDate(now.getDate()-1);
  if(d.toDateString()===y.toDateString())return'昨天 '+hm;
  return (d.getFullYear()===now.getFullYear()?'':d.getFullYear()+'-')+`${p(d.getMonth()+1)}-${p(d.getDate())} ${hm}`;
}
let viewedShown=60;
function meViewed(){
  setTab('me');clearInterval(timer);stopGalAuto();chip();
  const list=Auth.viewed();
  const shown=list.slice(0,viewedShown);
  const sub=n=>`${n} 部 · 看过的作品不再出现在首页，移除后可重新推荐`;
  const row=e=>{const w=workByCode(e.c);const L=w&&/^[\w.-]+$/.test(String(w.vid));
    const th=w&&hasCover(w)?imgTag(thumb(w.cover),'',full(w.cover)):'<div class="ph">—</div>';
    const body=`<div class="dav">${th}</div><div class="bd"><div class="nm">${esc(w?w.code:e.c)}${w&&Auth.isDisliked(w.code)?' <span class="dis-badge inline">已踩</span>':''}</div><div class="meta">${esc(w?short(w.title,40):'（不在当前片库）')}</div><div class="meta">🕘 ${esc(fmtViewTime(e.t))}${w&&names(w).length?' · '+esc(names(w).join(' / ')):''}</div></div>`;
    return `<div class="disitem" data-row="${esc(e.c)}">${L?`<a class="dlink" href="#/v/${w.vid}">${body}</a>`:`<div class="dlink">${body}</div>`}<button type="button" class="btn btn-sm btn-outline" data-unview="${esc(e.c)}">移除</button></div>`};
  $('#app').innerHTML=`<div class="page"><a class="back" href="#/me">← 我的</a>
    <div class="page-h"><div><h1>已浏览</h1><div class="sub">${sub(list.length)}</div></div>${list.length?'<button type="button" class="btn btn-sm btn-ghost" id="vclear">清空</button>':''}</div>
    ${list.length?`<div class="dislist">${shown.map(row).join('')}</div>${list.length>shown.length?`<button class="btn btn-outline btn-block" id="vmore" style="margin:12px 0">加载更多（${shown.length}/${list.length}）</button>`:''}`:`<div class="empty"><div class="big">🕘</div><p>还没有浏览记录</p><p style="font-size:12px">打开过的作品详情会记在这里，并且不再出现在首页</p></div>`}
  </div>`;
  const vm=$('#vmore');if(vm)vm.onclick=()=>{viewedShown+=60;const y=scrollY;meViewed();requestAnimationFrame(()=>scrollTo(0,y))};
  $$('[data-unview]').forEach(b=>b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    const c=b.dataset.unview;
    Auth.removeViewed(c);
    bumpView('#/');bumpView(viewKey('#/'));
    const r=b.closest('.disitem');if(r){r.classList.add('dis-out');setTimeout(()=>{if(r.isConnected)r.remove()},260)}
    const s=$('.page-h .sub');if(s)s.textContent=sub(Auth.viewed().length);
    toast(`已移除 ${c}，可重新出现在首页`,{label:'撤销',fn:()=>{Auth.addViewed(c);bumpView('#/');meViewed()}});
  });
  const vc=$('#vclear');
  if(vc)vc.onclick=()=>{
    if(!confirm(`清空全部 ${Auth.viewed().length} 条浏览记录？清空后这些作品会重新出现在首页。`))return;
    Auth.clearViewed();bumpView('#/');bumpView(viewKey('#/'));viewedShown=60;meViewed();toast('已清空浏览记录');
  };
}

function favList(){
  setTab('home');clearInterval(timer);stopGalAuto();chip();
  $('#app').innerHTML=`<div class="page"><a class="back" href="#/">← 首页</a>
    <div class="page-h"><div><h1>精选女优</h1><div class="sub">按演员归档 · 已关注优先 · ${favs.length} 位</div></div></div>
    <div class="aglist">${featuredGroups().map(g=>agroupHtml(g)).join('')||'<p class="empty">加载中…</p>'}</div></div>`;
  favList.rebind();
}
favList.rebind=function(s){
  bindFollowBtns();bindFavBtns();
  $$('[data-agmore]').forEach(b=>b.onclick=()=>{const k=b.dataset.agmore;agOpen[k]=!agOpen[k];
    const g=featuredGroups().find(x=>x.f.slug===k);const el=b.closest('.agroup');
    if(g&&el){el.outerHTML=agroupHtml(g);favList.rebind(k);if(!agOpen[k]){const n=document.querySelector(`.agroup[data-slug="${k}"]`);if(n)n.scrollIntoView({block:'nearest'})}}});
};

function fworkHtml(i){
  const L=/^[\w.-]+$/.test(String(i.vid));
  const fav=Auth.isFavorited(i.vid);
  return`<${L?'a':'div'} class="fwork" ${L?`href="#/v/${i.vid}"`:''}>
    ${hasCover(i)?imgTag(thumb(i.cover),'',full(i.cover)):'<div class="nocover">暂无官方封面</div>'}
    <div class="fb"><h4 class="work-id">${esc(i.code)}${Auth.isDisliked(i.code)?' <span class="dis-badge inline">已踩</span>':''} <button class="favbtn ${fav?'on':''}" style="position:static;display:inline-flex;width:22px;height:22px;font-size:12px;vertical-align:middle" data-fav="${esc(i.vid)}">${fav?'★':'☆'}</button></h4>
    <h4 class="work-title">${esc(i.title)}</h4>
    <div class="work-meta"><span>${esc(i.studio||'')}</span><span>${esc(i.date||'')}</span></div>
    <p class="syn">${i.plot_zh?esc(i.plot_zh):`<span style="color:var(--muted)">（暂无中文简介${L?'':'·javtext 未收录'}）${esc(i.title)}</span>`}</p></div></${L?'a':'div'}>`;
}
function favPage(slug){
  setTab('home');clearInterval(timer);stopGalAuto();chip();
  const f=resolveActress(slug);
  if(!f){$('#app').innerHTML='<div class="empty"><p>未找到该女优专辑。<a href="#/fav">返回</a></p></div>';return}
  const on=Auth.isFollowing(f.slug);
  const cnt=f.total&&f.total>f.works.length?`收录最新 ${f.works.length} 部 / 共 ${f.total} 部`:`${f.works.length} 部`;
  const PAGE=24;
  let shown=favShown[slug]||PAGE;
  if(shown>f.works.length)shown=f.works.length;
  favShown[slug]=shown;
  const slice=f.works.slice(0,shown);
  const more=shown<f.works.length;
  const coverWork=(f.works||[]).find(hasCover);
  const hero=coverWork?full(coverWork.cover):'';
  const backHref=f.local?'javascript:history.back()':'#/fav';
  const backLabel=f.local?'← 返回':'← 精选女优';
  $('#app').innerHTML=`<div class="page"><a class="back" href="${backHref}">${backLabel}</a>
    <div class="actor-hero">${hero?nz(`<img decoding="async" loading="eager" src="${esc(hero)}" alt="${esc(f.name)}" onerror="this.onerror=null;this.classList.add('broken')">`):'<div class="actor-hero-ph">暂无封面</div>'}</div>
    <div class="page-h"><div><h1>${esc(f.name)}${f.kind==='male'?' <span class="mbadge">男优</span>':''}${f.local?' <span class="badge">专辑</span>':''}</h1>
    <div class="sub">${esc((f.aliases||[]).join(' / ')||(f.local?'由作品自动生成':''))} · ${cnt}</div></div>
    <button class="btn btn-sm ${on?'btn-pink':'btn-outline'}" data-follow="${esc(f.slug)}">${on?'已关注':'关注'}</button></div>
    <div class="fworks" id="fworks">${slice.map(fworkHtml).join('')||'<p class="empty">暂无收录作品</p>'}</div>
    ${more?`<button class="btn btn-outline btn-block" id="fmore" style="margin:12px 0">加载更多（已显示 ${shown}/${f.works.length}）</button>`:''}
  </div>`;
  bindFollowBtns();bindFavBtns();
  const mb=$('#fmore');
  if(mb)mb.onclick=()=>{favShown[slug]=Math.min(f.works.length,(favShown[slug]||PAGE)+PAGE);favPage(slug)};
  scrollTo(0,0);
}
function bindFollowBtns(){
  $$('[data-follow]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    if(!Auth.current()){retHash=location.hash||'#/';location.hash='#/login';return}
    try{
      const on=await Auth.toggleFollow(b.dataset.follow);
      if(!b.isConnected)return;
      const sm=b.className.includes('btn-sm');
      const label=b.textContent.replace(/^已关注|^关注/,'').trim();
      b.className=`btn${sm?' btn-sm':''} ${on?'btn-pink':'btn-outline'}`;
      b.textContent=(on?'已关注':'关注')+(label?' '+label:'');
    }catch(err){alert(err.message||String(err))}
  });
}

function detail(v){
  setTab('home');clearInterval(timer);stopGalAuto();chip();
  const i=byVid(v);
  if(!i){$('#app').innerHTML='<div class="empty"><p>未找到该作品。<a href="#/">返回</a></p></div>';return}
  try{Auth.addViewed(i.code)}catch(_){}
  const fav=Auth.isFavorited(i.vid);
  const actNames=[...new Set((i.actresses||[]).map(a=>a.name).filter(Boolean).concat(names(i)))];
  const acts=actNames.length?actNames.map(n=>{
    const al=buildActressAlbum(n);
    const followed=al&&Auth.isFollowing(al.slug);
    return `<button type="button" class="act-chip ${followed?'on':''}" data-actress="${esc(n)}" data-slug="${esc(al.slug)}">${esc(n)}${followed?' ★':''}</button>`;
  }).join(''):'—';
  const linked=favs.filter(f=>names(i).some(n=>n.includes(f.name)||(f.aliases||[]).some(a=>n.includes(a)))||f.works.some(w=>w.vid===i.vid));
  const driveUrl=driveCfg.url||`https://drive.google.com/drive/folders/${driveCfg.folderId||''}`;
  $('#app').innerHTML=`<div class="detail">
    <div id="dgal-wrap"><div class="dgallery" id="dgal"><div class="dtrack"></div><div class="dcounter"><span id="dcur">1</span>/<span id="dtot">0</span></div><div class="ddots"></div></div></div>
    <div class="body">
      <a class="back" href="javascript:history.back()">← 返回</a>
      <button type="button" class="code code-copy" id="copy-code" title="点击复制番号">${esc(i.code)} <span class="copy-hint">复制</span></button>
      <h1>${esc(i.title)}</h1>
      <div class="meta">📅 ${esc(i.date)}　🎥 ${esc(i.studio)}${i.series?'　🗂️ '+esc(i.series):''}${i.label?'　🏷️ '+esc(i.label):''}</div>
      <div class="acts">${acts}</div>
      <div class="tags">${(i.genres||[]).map(g=>`<span>${esc(g)}</span>`).join('')}</div>
      <div class="actions">
        <button class="btn ${fav?'btn-pink':'btn-outline'}" id="dfav">${fav?'★ 已收藏':'☆ 收藏'}</button>
        <button type="button" class="btn btn-ghost dis-btn ${Auth.isDisliked(i.code)?'on':''}" id="ddisl">${Auth.isDisliked(i.code)?'👎 已踩 · 撤销':'👎 不感兴趣'}</button>
        ${linked.map(f=>{const on=Auth.isFollowing(f.slug);return`<button class="btn ${on?'btn-pink':'btn-outline'}" data-follow="${f.slug}">${on?'已关注':'关注'} ${esc(f.name)}</button>`}).join('')}
      </div>
      <div class="upload-box" id="upload-box">
        <div class="upload-row">
          <button type="button" class="btn btn-pink" id="upbtn">上传截图</button>
          <input type="file" id="upfile" accept="image/*" multiple hidden>
          <span class="upload-hint-inline" id="upstat"></span>
        </div>
        <p class="upload-note">截图已保存到云端，刷新或换设备登录同一账号不丢失。备份目录：Google Drive「番号截图」。<a href="${esc(driveUrl)}" target="_blank" rel="noopener">打开云端文件夹 ↗</a></p>
      </div>
      <h3 style="font-size:14px;margin:16px 0 0">中文剧情</h3>
      <div class="plot">${esc(i.plot_zh||'暂无')}</div>
      <p class="src">封面：${hasCover(i)?'R18.dev / DMM':'暂无'}　${i.url?`<a target="_blank" rel="noopener" href="${esc(i.url)}">javtext ↗</a>`:''}</p>
    </div></div>`;
  const dfav=$('#dfav');
  if(dfav)dfav.onclick=async()=>{
    if(!Auth.current()){retHash=location.hash;location.hash='#/login';return}
    const was=dfav.classList.contains('btn-pink');
    dfav.className=`btn ${was?'btn-outline':'btn-pink'}`;
    dfav.textContent=was?'☆ 收藏':'★ 已收藏';
    try{
      const on=await Auth.toggleFavorite(i.vid);
      if(!dfav.isConnected)return;
      dfav.className=`btn ${on?'btn-pink':'btn-outline'}`;
      dfav.textContent=on?'★ 已收藏':'☆ 收藏';
    }catch(err){
      if(dfav.isConnected){dfav.className=`btn ${was?'btn-pink':'btn-outline'}`;dfav.textContent=was?'★ 已收藏':'☆ 收藏'}
      toast('收藏失败：'+(err.message||err));
    }
  };
  bindFollowBtns();
  const ddisl=$('#ddisl');
  const paintDisl=()=>{if(!ddisl.isConnected)return;const on=Auth.isDisliked(i.code);ddisl.classList.toggle('on',on);ddisl.textContent=on?'👎 已踩 · 撤销':'👎 不感兴趣'};
  if(ddisl)ddisl.onclick=async()=>{
    ddisl.disabled=true;
    await doDislike(i.code,!Auth.isDisliked(i.code),{onUndo:paintDisl});
    ddisl.disabled=false;paintDisl();
  };
  const copyBtn=$('#copy-code');
  if(copyBtn)copyBtn.onclick=async()=>{
    const ok=await copyText(i.code);
    toast(ok?`已复制 ${i.code}`:'复制失败，请长按番号');
  };
  $$('[data-actress]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    const name=b.dataset.actress;
    if(!Auth.current()){retHash=location.hash||'#/';location.hash='#/login';return}
    try{
      const album=buildActressAlbum(name);
      if(!album){toast('无法创建专辑');return}
      bumpView(lastViewKey);
      if(!Auth.isFollowing(album.slug)){
        await Auth.toggleFollow(album.slug);
        toast(`已收藏 ${album.name}`);
      }else{
        toast(`${album.name} 专辑`);
      }
      location.hash='#/fav/'+album.slug;
    }catch(err){alert(err.message||String(err))}
  });
  const upbtn=$('#upbtn'),upfile=$('#upfile'),upstat=$('#upstat');
  const upbox=$('#upload-box');
  if(upbtn&&upfile){
    upbtn.onclick=()=>{
      if(!Auth.current()){retHash=location.hash;location.hash='#/login';return}
      upfile.click();
    };
    upfile.onchange=async()=>{
      const files=upfile.files;if(!files||!files.length)return;
      upbtn.disabled=true;
      let bar=upbox&&upbox.querySelector('.up-progress');
      if(!bar&&upbox){
        bar=document.createElement('div');
        bar.className='up-progress';
        bar.innerHTML='<div class="up-progress-track"><div class="up-progress-fill" id="upfill"></div></div><div class="up-progress-txt" id="uptxt">准备中…</div>';
        upbox.insertBefore(bar, upbox.querySelector('.upload-note'));
      }
      const fill=$('#upfill'),txt=$('#uptxt');
      const setP=(pct,msg)=>{if(fill)fill.style.width=Math.max(0,Math.min(100,pct))+'%';if(txt)txt.textContent=msg;if(upstat)upstat.textContent=msg};
      setP(2,'准备上传…');
      try{
        const added=await Uploads.addFiles(Auth.current(),i.code,files,{
          onProgress:(p)=>{
            const pct=p.percent!=null?p.percent:(p.done&&p.total?Math.round(100*p.done/p.total):0);
            const msg=p.message||`上传中 ${p.index||0}/${p.total||0}`;
            setP(pct,msg);
          }
        });
        setP(100, added.length?`已上传 ${added.length} 张`:'完成');
        await renderDetailGallery(i);
        // scroll gallery to last uploaded if possible
        if(_galCtl&&added.length)_galCtl.go(9999);
      }catch(e){setP(0,e.message||String(e))}
      finally{upbtn.disabled=false;upfile.value=''}
    };
  }
  renderDetailGallery(i);scrollTo(0,0);
}
let _galCtl=null,_galTimer=null,_galResume=null;
function stopGalAuto(){
  clearInterval(_galTimer);_galTimer=null;
  clearTimeout(_galResume);_galResume=null;
}
async function renderDetailGallery(i){
  const wrap=$('#dgal-wrap');if(!wrap)return;
  stopGalAuto();
  let userRows=[];
  try{if(Auth.current()&&typeof Uploads!=='undefined')userRows=await Uploads.list(Auth.current(),i.code)}catch(_){}
  const slides=gallerySlides(i,userRows);
  if(!slides.length){
    wrap.innerHTML=hasCover(i)?nz(`<img class="cover" decoding="async" src="${esc(full(i.cover))}" alt="${esc(i.code)}" onerror="this.onerror=null;this.style.display='none'">`):'<div class="dgallery empty-gal"><div class="ph">暂无封面</div></div>';
    _galCtl=null;return;
  }
  const thumbs=slides.length>1?`<div class="dthumbs" id="dthumbs">${slides.map((sl,k)=>`<button type="button" class="dthumb" data-k="${k}" aria-label="第 ${k+1} 张">${nz(`<img loading="lazy" decoding="async" src="${esc(sl.src)}" alt="">`,'mini').replace('<span class="nz',`<span data-k="g${k}" class="nz`)}</button>`).join('')}</div>`:'';
  wrap.innerHTML=`<div class="dgallery" id="dgal">
      <div class="dtrack">${slides.map((sl,k)=>slideHtml(sl,k,i.code)).join('')}</div>
      <div class="dcounter"><span id="dcur">1</span>/${slides.length}</div>
    </div>${thumbs}`;
  $$('[data-del]').forEach(b=>b.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    if(!confirm('删除这张我的截图？'))return;
    try{await Uploads.remove(b.dataset.del);await renderDetailGallery(i)}catch(err){alert(err.message||String(err))}
  });
  _galCtl=initDetailGallery();
}
function initDetailGallery(){
  const gal=$('#dgal');if(!gal)return null;
  const tr=gal.querySelector('.dtrack'),n=tr.children.length,cur=$('#dcur');
  const thumbs=$$('#dthumbs .dthumb');
  let k=0,x0=0,dx=0,drag=false;
  const go=(i,fromUser)=>{
    if(n<=0)return;
    k=Math.max(0,Math.min(n-1,i|0));
    tr.style.transform=`translateX(-${k*100}%)`;
    if(cur)cur.textContent=String(k+1);
    thumbs.forEach((d,j)=>{
      d.classList.toggle('on',j===k);
      if(j===k)try{d.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'})}catch(_){}
    });
    if(fromUser)bumpAuto();
  };
  const startAuto=()=>{
    stopGalAuto();
    if(n<=1)return;
    _galTimer=setInterval(()=>go(k>=n-1?0:k+1,false),3500);
  };
  const bumpAuto=()=>{
    stopGalAuto();
    if(n<=1)return;
    _galResume=setTimeout(startAuto,5000);
  };
  thumbs.forEach(d=>d.onclick=()=>go(+d.dataset.k,true));
  const start=e=>{
    if(e.target&&e.target.closest&&e.target.closest('.slide-del'))return;
    drag=true;x0=('touches' in e?e.touches[0].clientX:e.clientX);dx=0;tr.style.transition='none';
    bumpAuto();
  };
  const move=e=>{if(!drag)return;const x=('touches' in e?e.touches[0].clientX:e.clientX);dx=x-x0;tr.style.transform=`translateX(calc(-${k*100}% + ${dx}px))`};
  const end=()=>{if(!drag)return;drag=false;tr.style.transition='';if(Math.abs(dx)>40)go(k+(dx<0?1:-1),true);else go(k,true)};
  gal.addEventListener('touchstart',start,{passive:true});gal.addEventListener('touchmove',move,{passive:true});gal.addEventListener('touchend',end);
  gal.addEventListener('mousedown',start);window.addEventListener('mousemove',move);window.addEventListener('mouseup',end);
  go(0,false);startAuto();
  return {go:(i)=>go(i,true),stop:stopGalAuto,resume:startAuto};
}

/* ---------- router ---------- */
function renderRoute(h){
  let m;
  if(m=h.match(/^#\/login/))loginPage(false);
  else if(m=h.match(/^#\/register/))loginPage(true);
  else if(m=h.match(/^#\/v\/(.+)/))detail(m[1]);
  else if(m=h.match(/^#\/fav\/([\w-]+)/))favPage(m[1]);
  else if(h.startsWith('#/fav'))favList();
  else if(h.startsWith('#/following'))followingPage();
  else if(h.startsWith('#/offline'))offlinePage();
  else if(h.startsWith('#/me/favorites'))meFavorites();
  else if(h.startsWith('#/me/dislikes'))meDislikes();
  else if(h.startsWith('#/me/viewed'))meViewed();
  else if(h.startsWith('#/me'))mePage();
  else home();
}
function route(){
  const h=location.hash||'#/';
  if(needAuth(h))return;
  const key=viewKey(h);
  if(lastViewKey&&lastViewKey!==key)saveView(lastViewKey);
  if(viewStore.has(key)&&restoreView(key)){
    lastViewKey=key;
    if(key==='#/')try{pruneViewedHome()}catch(_){}
    return;
  }
  lastViewKey=key;
  renderRoute(h);
}

$('#q').oninput=()=>{
  if(!location.hash.startsWith('#/v/')&&!location.hash.startsWith('#/fav/')&&!location.hash.startsWith('#/me')&&!location.hash.startsWith('#/following')&&!location.hash.startsWith('#/offline')){
    bumpView(lastViewKey);bumpView('#/');lastViewKey=null;
    if(location.hash!=='#/'&&location.hash!=='')location.hash='#/';
    else{lastViewKey=viewKey('#/');home()}
  }
};
onhashchange=route;
setupGate();
setupSwipeBack();
setupNsfw();

function setupSwipeBack(){
  let x0=0,y0=0,on=false;
  const edge=32;
  const shell=$('#shell')||document.body;
  shell.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    const t=e.touches[0];
    // only from left edge; avoid fighting gallery swipes that start mid-screen
    if(t.clientX>edge){on=false;return}
    on=true;x0=t.clientX;y0=t.clientY;
  },{passive:true});
  shell.addEventListener('touchend',e=>{
    if(!on)return;on=false;
    const t=e.changedTouches[0];
    const dx=t.clientX-x0,dy=t.clientY-y0;
    if(dx<80||Math.abs(dx)<Math.abs(dy)*1.2)return;
    const h=location.hash||'#/';
    if(!h||h==='#'||h==='#/'||/^#\/(login|register)/.test(h))return;
    history.back();
  },{passive:true});
}

function fetchJson(url,ms){
  const ctrl=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=ctrl?setTimeout(()=>ctrl.abort(),ms||12000):null;
  return fetch(url,{cache:'no-store',signal:ctrl?ctrl.signal:undefined})
    .then(r=>{if(!r.ok)throw new Error(url.split('?')[0]+' '+r.status);return r.json()})
    .finally(()=>{if(timer)clearTimeout(timer)});
}
function paintBoot(){
  chip();
  const authed=!!(Auth.current()&&Auth.getToken());
  if(!authed&&!/^#\/(login|register)/.test(location.hash||'')){
    retHash=location.hash||'#/';
    if(location.hash!=='#/login')location.hash='#/login';
  }
  try{route()}catch(e){
    if($('#app'))$('#app').innerHTML=`<div class="empty"><p>页面渲染失败</p><p style="font-size:12px">${esc(e.message||e)}</p></div>`;
  }
}
async function boot(){
  if($('#app'))$('#app').innerHTML='<div class="empty"><p>加载中…</p></div>';
  try{
    // Critical path only — never block first paint on auth or fav.json
    const d=await fetchJson('data.json?t='+Date.now(),15000);
    items=dedupeByCode(d.items||[]);
  }catch(err){
    const msg=err&&err.name==='AbortError'?'加载超时，请检查网络':(err&&err.message?err.message:String(err));
    if($('#app'))$('#app').innerHTML=`<div class="empty"><div class="big">😵</div><p>加载失败</p><p style="font-size:12px;color:var(--muted)">${esc(msg)}</p><button class="btn btn-pink" style="margin-top:12px" onclick="location.reload()">重试</button></div>`;
    return;
  }
  paintBoot();
  // Background: extras + session restore (timeout so it cannot freeze UI)
  Promise.all([
    fetchJson('fav.json?t='+Date.now(),20000).then(f=>{favs=f.actresses||[];const h=location.hash||'';if(h.startsWith('#/fav')||h.startsWith('#/v/')||h.startsWith('#/me')){try{route()}catch(_){}}}).catch(()=>{favs=favs||[]}),
    fetchJson('samples.json?t='+Date.now(),12000).then(sm=>{samplesMap=sm.samples||{};}).catch(()=>{}),
    fetchJson('hot_week.json?t='+Date.now(),10000).then(w=>{hotWeek=w&&w.ranks?w:{ranks:{},snapshots:[]}}).catch(()=>{hotWeek={ranks:{},snapshots:[]}}),
    fetchJson('drive.json?t='+Date.now(),8000).then(dr=>{if(dr&&dr.folderId)driveCfg=dr}).catch(()=>{}),
  ]).then(()=>{
    // soft refresh home once so 热门 (fav works + hot_week) is complete (invalidate cache)
    const h=location.hash||'#/';
    if(h==='#'||h==='#/'||h===''){
      bumpView('#/');bumpView(viewKey('#/'));lastViewKey=null;
      try{home();lastViewKey=viewKey('#/')}catch(_){}
    }
  });
  if(Auth.getToken&&Auth.getToken()){
    const to=new Promise(res=>setTimeout(()=>res(null),3500));
    Promise.race([Auth.refresh().catch(()=>null),to]).then(()=>{chip()});
  }
}
boot();
