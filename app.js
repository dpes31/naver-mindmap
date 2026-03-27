// ── 설정 ──────────────────────────────────────────
const DEPTH_COLORS  = ['#1a56db', '#22c55e', '#f59e0b', '#8b5cf6'];
const DEPTH_RADIUS  = [44, 32, 24, 18];
const DEPTH_OPACITY = [1, 0.92, 0.85, 0.80];
const MAX_DEPTH     = 3;
const BRANCH_LIMITS = [Infinity, 8, 4, 2];

// ── Naver API 호출 ─────────────────────────────────

function wrapStrings(arr) {
  return arr.map(k => typeof k === 'string'
    ? { keyword:k, totalVol:0, pcVol:0, mobileVol:0, pcClicks:0, mobileClicks:0, pcCtr:0, mobileCtr:0 }
    : k);
}

function parseRelatedFromHtml(html) {
  if (!html || html.length < 500) return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const SELS = ['a[href*="related_query"]','.lst_related_srch .tit','.related_srch a','#nx_related_kwd a','[class*="relatedKeyword"] a'];
    for (const s of SELS) {
      const kws = [...doc.querySelectorAll(s)].map(e=>e.textContent.trim()).filter(k=>k.length>=2&&k.length<=40);
      if (kws.length>=2) return [...new Set(kws)].slice(0,10);
    }
    for (const s of doc.querySelectorAll('script')) {
      const m = s.textContent.match(/"relatedKeywords?":\s*\[([^\]]+)\]/);
      if (m) { const kws=[...m[1].matchAll(/"([^"]{2,40})"/g)].map(x=>x[1]); if(kws.length>=2) return kws.slice(0,10); }
    }
  } catch(e){}
  try {
    const hrefs=[...html.matchAll(/related_query[^"]*"[^>]*>\s*([^<]{2,40})\s*<\/a>/g)].map(m=>m[1].trim());
    if (hrefs.length>=2) return [...new Set(hrefs)].slice(0,10);
    const idx=html.indexOf('연관검색어');
    if (idx>0) {
      const sec=html.slice(idx,idx+4000);
      const kws=[...sec.matchAll(/<a[^>]*>\s*([^<]{2,30})\s*<\/a>/g)].map(m=>m[1].trim()).filter(k=>k.length>=2);
      if (kws.length>=2) return [...new Set(kws)].slice(0,10);
    }
  } catch(e){}
  return [];
}

async function fetchViaAllOrigins(keyword) {
  const urls = [
    'https://m.search.naver.com/search.naver?where=m&query='+encodeURIComponent(keyword),
    'https://search.naver.com/search.naver?query='+encodeURIComponent(keyword),
  ];
  for (const u of urls) {
    try {
      const r=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(u),{signal:AbortSignal.timeout(9000)});
      if (r.ok){const kws=parseRelatedFromHtml(await r.text());if(kws.length>=2)return kws;}
    } catch(e){}
    try {
      const r=await fetch('https://api.allorigins.win/get?url='+encodeURIComponent(u),{signal:AbortSignal.timeout(9000)});
      if (r.ok){const j=await r.json();const kws=parseRelatedFromHtml(j.contents||'');if(kws.length>=2)return kws;}
    } catch(e){}
  }
  return [];
}

async function fetchViaCorsproxy(keyword) {
  const mu='https://m.search.naver.com/search.naver?where=m&query='+encodeURIComponent(keyword);
  for (const p of ['https://corsproxy.io/?'+encodeURIComponent(mu),'https://proxy.cors.sh/'+mu]) {
    try {
      const r=await fetch(p,{signal:AbortSignal.timeout(9000)});
      if (r.ok){const kws=parseRelatedFromHtml(await r.text());if(kws.length>=2)return kws;}
    } catch(e){}
  }
  return [];
}

function fetchNaverAutocomplete(keyword) {
  return new Promise(resolve=>{
    const cb='__nc_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const sc=document.createElement('script');
    const t=setTimeout(()=>{cleanup();resolve([]);},6000);
    function cleanup(){clearTimeout(t);try{document.head.removeChild(sc);}catch(e){}delete window[cb];}
    window[cb]=d=>{cleanup();try{const r=d?.items?.[0]||[];resolve(r.map(i=>Array.isArray(i)?i[0]:i).filter(k=>k&&k.trim()).slice(0,10));}catch(e){resolve([]);}};
    sc.onerror=()=>{cleanup();resolve([]);};
    sc.src='https://ac.search.naver.com/nx/ac?q='+encodeURIComponent(keyword)+'&st=1100&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&ans=2&run=2&rev=4&_callback='+cb;
    document.head.appendChild(sc);
  });
}

async function fetchNaverKeywords(keyword) {
  try {
    const r=await fetch('/api/keywords?keyword='+encodeURIComponent(keyword),{signal:AbortSignal.timeout(10000)});
    if (r.ok){const d=await r.json();if(d.keywords?.length>=2)return d.keywords;}
  } catch(e){}
  try { const k=await fetchViaAllOrigins(keyword); if(k.length>=2) return wrapStrings(k); } catch(e){}
  try { const k=await fetchViaCorsproxy(keyword);  if(k.length>=2) return wrapStrings(k); } catch(e){}
  return wrapStrings(await fetchNaverAutocomplete(keyword));
}

// ── 통계 패널 렌더 ──────────────────────────────────
function renderStats(keyword, items) {
  document.getElementById('stats-kw').textContent = keyword;
  const wrap = document.getElementById('bar-chart');
  wrap.innerHTML = '';

  const valid = items.filter(d=>d.totalVol>0).slice(0,10);
  if (!valid.length) {
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:12px 0">검색량 데이터 없음 — Vercel 환경변수의 API 키를 확인하세요.</p>';
    // 성별/연령 placeholder는 유지
    renderGenderAge(null);
    return;
  }

  const maxVol = Math.max(...valid.map(d=>d.pcVol+d.mobileVol), 1);

  valid.forEach((d,i)=>{
    const pcPct  = Math.max(1, Math.round((d.pcVol/maxVol)*100));
    const mobPct = Math.max(1, Math.round((d.mobileVol/maxVol)*100));
    const fmt = n => n>=10000 ? Math.round(n/1000)+'k' : n.toLocaleString();
    const clicks = ((d.pcClicks||0)+(d.mobileClicks||0));

    const row = document.createElement('div');
    row.className = 'kw-row';
    row.innerHTML = `
      <div class="kw-name"><span class="kw-rank">${i+1}</span>${d.keyword}</div>
      <div class="bars-col">
        <div class="bar-row">
          <span class="bar-label" style="color:#1a56db">PC</span>
          <div class="bar-track"><div class="bar-fill pc" style="width:${pcPct}%"></div></div>
          <span class="bar-val">${fmt(d.pcVol)}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label" style="color:#16a34a">MO</span>
          <div class="bar-track"><div class="bar-fill mob" style="width:${mobPct}%"></div></div>
          <span class="bar-val">${fmt(d.mobileVol)}</span>
        </div>
      </div>
      <div class="metrics-col">
        <div class="metric-item">클릭수 <b>${fmt(clicks)}</b></div>
        <div class="metric-item">PC CTR <b>${d.pcCtr||0}%</b></div>
        <div class="metric-item">MO CTR <b>${d.mobileCtr||0}%</b></div>
      </div>`;
    wrap.appendChild(row);
  });

  renderGenderAge(valid[0]);
}

function renderGenderAge(top) {
  const gs = document.getElementById('gender-section');
  const as = document.getElementById('age-section');
  // 실제 DataLab API 없이는 정확한 비율을 알 수 없음
  // placeholder 구조만 제공
  gs.innerHTML = `
    <div class="ga-title">성별 검색 비율</div>
    <div class="ga-placeholder">
      네이버 DataLab API 연동 시 표시<br>
      <span style="font-size:11px;margin-top:4px;display:block">별도 API 신청 필요</span>
    </div>`;
  as.innerHTML = `
    <div class="ga-title">연령별 검색 비율</div>
    <div class="ga-placeholder">
      네이버 DataLab API 연동 시 표시<br>
      <span style="font-size:11px;margin-top:4px;display:block">별도 API 신청 필요</span>
    </div>`;
}

// ── 노드 반경 (텍스트 길이 + 검색량 반영) ──────────────
function nodeRadius(d) {
  const base = DEPTH_RADIUS[Math.min(d.depth,3)];
  // 텍스트 길이 기반 최소 반경
  const textMin = Math.max(base, (d.label.length * 5.5) / 2 + 10);
  if (!d.totalVol) return textMin;
  const same = nodes.filter(n=>n.depth===d.depth&&n.totalVol>0);
  if (!same.length) return textMin;
  const maxV = Math.max(...same.map(n=>n.totalVol),1);
  const scale = Math.log1p(d.totalVol)/Math.log1p(maxV);
  return Math.max(textMin, base + (scale-0.5)*14);
}

function linkWidth(d) {
  const tid = d.target?.id||d.target;
  const t = nodes.find(n=>n.id===tid);
  if (!t?.totalVol) return 1.5;
  const same = nodes.filter(n=>n.depth===t.depth&&n.totalVol>0);
  const maxV = Math.max(...same.map(n=>n.totalVol),1);
  const scale = Math.log1p(t.totalVol)/Math.log1p(maxV);
  return 1 + scale*5; // 1~6px
}

function linkColor(d) {
  // 검색량 강도 → 선 색 진하기
  const tid = d.target?.id||d.target;
  const t = nodes.find(n=>n.id===tid);
  if (!t?.totalVol) return 'rgba(160,174,192,0.3)';
  const same = nodes.filter(n=>n.depth===t.depth&&n.totalVol>0);
  const maxV = Math.max(...same.map(n=>n.totalVol),1);
  const scale = Math.log1p(t.totalVol)/Math.log1p(maxV);
  const alpha = 0.15 + scale*0.5;
  return `rgba(99,102,241,${alpha.toFixed(2)})`;
}

// ── D3 초기화 ───────────────────────────────────────
const svg = d3.select('#graph');
let width = 0, height = 0;

function getSvgSize() {
  const el = document.getElementById('graph');
  return { w: el.clientWidth||800, h: el.clientHeight||600 };
}

const defs = svg.append('defs');

// Glow 필터
const glow = defs.append('filter').attr('id','glow').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
glow.append('feGaussianBlur').attr('stdDeviation','5').attr('result','coloredBlur');
const fm = glow.append('feMerge');
fm.append('feMergeNode').attr('in','coloredBlur');
fm.append('feMergeNode').attr('in','SourceGraphic');

// 그라디언트
function lighten(hex,a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,Math.round(r+(255-r)*a))},${Math.min(255,Math.round(g+(255-g)*a))},${Math.min(255,Math.round(b+(255-b)*a))})`;
}
DEPTH_COLORS.forEach((c,i)=>{
  const gr=defs.append('radialGradient').attr('id',`grad-${i}`).attr('cx','35%').attr('cy','35%').attr('r','65%');
  gr.append('stop').attr('offset','0%').attr('stop-color',lighten(c,0.35)).attr('stop-opacity',DEPTH_OPACITY[i]);
  gr.append('stop').attr('offset','100%').attr('stop-color',c).attr('stop-opacity',DEPTH_OPACITY[i]);
});

const zoomG = svg.append('g').attr('id','zoom-layer');
const zoom = d3.zoom().scaleExtent([0.15,5]).on('zoom',e=>zoomG.attr('transform',e.transform));
svg.call(zoom).on('dblclick.zoom',null);

const linksG = zoomG.append('g').attr('id','links');
const nodesG = zoomG.append('g').attr('id','nodes');

const simulation = d3.forceSimulation()
  .force('link', d3.forceLink().id(d=>d.id).distance(d=>100+(d.target.depth||0)*55).strength(0.55))
  .force('charge', d3.forceManyBody().strength(-380).distanceMax(600))
  .force('center', d3.forceCenter(400,300))
  .force('collision', d3.forceCollide().radius(d=>nodeRadius(d)+16))
  .alphaDecay(0.025);

let nodes=[], links=[];
const nodeIds = new Set();
let isLoading = false;

// ── 그래프 렌더 ─────────────────────────────────────
function updateGraph() {
  const {w,h} = getSvgSize();
  width=w; height=h;

  // 링크
  const link = linksG.selectAll('line').data(links, d=>`${d.source?.id||d.source}→${d.target?.id||d.target}`);
  const le = link.enter().append('line').attr('stroke-linecap','round');
  link.exit().remove();

  // 노드
  const node = nodesG.selectAll('g.node-group').data(nodes, d=>d.id);
  const enter = node.enter().append('g').attr('class','node-group')
    .style('opacity',0).style('cursor','pointer')
    .call(d3.drag()
      .on('start',(e,d)=>{if(!e.active)simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
      .on('drag', (e,d)=>{d.fx=e.x;d.fy=e.y;})
      .on('end',  (e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}))
    .on('mouseenter',onHover).on('mouseleave',onLeave).on('click',onClick);

  // 글로우
  enter.append('circle').attr('class','node-glow')
    .attr('r',d=>nodeRadius(d)+10).attr('fill',d=>DEPTH_COLORS[Math.min(d.depth,3)])
    .attr('fill-opacity',0.07).attr('stroke','none');

  // 원
  enter.append('circle').attr('class','node-circle')
    .attr('r',d=>nodeRadius(d))
    .attr('fill',d=>`url(#grad-${Math.min(d.depth,3)})`)
    .attr('stroke','rgba(255,255,255,0.7)')
    .attr('stroke-width',d=>d.depth===0?3:1.5);

  // 텍스트 (줄바꿈)
  enter.each(function(d) {
    const g = d3.select(this);
    const r = nodeRadius(d);
    const maxW = r * 1.7;
    const fontSize = d.depth===0 ? 13 : d.depth===1 ? 11 : 10;
    const charsPerLine = Math.floor(maxW / (fontSize * 0.65));
    const words = d.label.split('');
    const lines = [];
    for (let i=0; i<words.length; i+=charsPerLine) lines.push(words.slice(i,i+charsPerLine).join(''));
    const lineH = fontSize + 2;
    const totalH = lines.length * lineH;
    const startY = -totalH/2 + lineH/2;
    const txt = g.append('text').attr('class','node-label')
      .attr('text-anchor','middle')
      .attr('fill','#111827')
      .attr('stroke','rgba(255,255,255,0.92)')
      .attr('stroke-width',3).attr('paint-order','stroke')
      .attr('font-size',`${fontSize}px`)
      .attr('font-weight',d.depth===0?'700':'600')
      .attr('font-family','-apple-system,BlinkMacSystemFont,system-ui,sans-serif')
      .attr('pointer-events','none');
    lines.forEach((l,i)=>{
      txt.append('tspan').attr('x',0).attr('dy', i===0 ? startY : lineH).text(l);
    });
  });

  enter.transition().duration(500).ease(d3.easeCubicOut).style('opacity',1);
  node.exit().remove();

  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.force('collision').radius(d=>nodeRadius(d)+14);
  simulation.force('center',d3.forceCenter(width/2,height/2));
  simulation.alpha(0.5).restart();

  // 링크 스타일 업데이트
  linksG.selectAll('line')
    .attr('stroke',d=>linkColor(d))
    .attr('stroke-width',d=>linkWidth(d));

  simulation.on('tick',()=>{
    linksG.selectAll('line')
      .attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
      .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    nodesG.selectAll('g.node-group')
      .attr('transform',d=>`translate(${d.x},${d.y})`);
  });
}

// ── 호버 / 클릭 ─────────────────────────────────────
const tooltipEl = document.getElementById('tooltip');
const infoPanelEl = document.getElementById('info-panel');

function onHover(e,d) {
  const r = nodeRadius(d);
  d3.select(this).select('.node-circle').attr('filter','url(#glow)').transition().duration(150).attr('r',r*1.12);
  d3.select(this).select('.node-glow').transition().duration(150).attr('fill-opacity',0.18);
  tooltipEl.textContent = d.label;
  tooltipEl.style.left=(e.clientX+14)+'px'; tooltipEl.style.top=(e.clientY-8)+'px';
  tooltipEl.classList.add('visible');
}
function onLeave(e,d) {
  const r = nodeRadius(d);
  d3.select(this).select('.node-circle').attr('filter',null).transition().duration(150).attr('r',r);
  d3.select(this).select('.node-glow').transition().duration(150).attr('fill-opacity',0.07);
  tooltipEl.classList.remove('visible');
}
function onClick(e,d) {
  e.stopPropagation();
  if (isLoading) return;
  const fmt = n=>(n||0)>=10000?Math.round((n||0)/1000)+'k':(n||0).toLocaleString();
  const clicks = (d.pcClicks||0)+(d.mobileClicks||0);
  infoPanelEl.innerHTML = `
    <strong>${d.label}</strong>
    <span style="font-size:11px;color:#6b7280;font-weight:500">${d.depth}차 연관어</span>
    ${d.totalVol ? `<div class="info-metric">
      <div class="info-metric-row"><span class="k">PC 검색</span><span class="v" style="color:#1a56db">${fmt(d.pcVol)}</span></div>
      <div class="info-metric-row"><span class="k">MO 검색</span><span class="v" style="color:#16a34a">${fmt(d.mobileVol)}</span></div>
      <div class="info-metric-row"><span class="k">클릭수</span><span class="v">${fmt(clicks)}</span></div>
      <div class="info-metric-row"><span class="k">PC CTR</span><span class="v">${d.pcCtr||0}%</span></div>
      <div class="info-metric-row"><span class="k">MO CTR</span><span class="v">${d.mobileCtr||0}%</span></div>
    </div>` : ''}
    <div class="hint" onclick="window.reSearch('${d.label.replace(/'/g,"\\'")}')">이 키워드로 새 검색 →</div>`;
  infoPanelEl.classList.add('visible');
}
svg.on('click',()=>infoPanelEl.classList.remove('visible'));
window.reSearch = kw => { document.getElementById('searchInput').value=kw; startSearch(kw); };

// ── BFS 수집 ────────────────────────────────────────
async function collectAll(rootKeyword, rootId) {
  const queue=[{kw:rootKeyword,parentId:rootId,depth:1}];
  let processed=0;
  while (queue.length>0 && nodes.length<300) {
    const batch=queue.splice(0,5);
    const results=await Promise.allSettled(batch.map(it=>fetchNaverKeywords(it.kw)));
    results.forEach((r,i)=>{
      processed++;
      document.getElementById('loading-progress').textContent = `${processed}개 수집 완료`;
      if (r.status!=='fulfilled') return;
      const {parentId,depth}=batch[i];
      r.value.slice(0,BRANCH_LIMITS[depth]??2).forEach(item=>{
        const id=item.keyword.toLowerCase().trim();
        if (!id) return;
        if (nodeIds.has(id)) {
          if (!links.find(l=>(l.source?.id||l.source)===parentId&&(l.target?.id||l.target)===id))
            links.push({source:parentId,target:id});
          return;
        }
        nodeIds.add(id);
        nodes.push({id,label:item.keyword,depth,
          totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
          pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
          pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0});
        links.push({source:parentId,target:id});
        if (depth<MAX_DEPTH) queue.push({kw:item.keyword,parentId:id,depth:depth+1});
      });
    });
  }
}

// ── UI 유틸 ─────────────────────────────────────────
const loadingEl   = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const emptyState  = document.getElementById('empty-state');
const toastEl     = document.getElementById('toast');
let toastTimer;

function showToast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent=msg; toastEl.classList.add('show');
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);
}
function setLoading(active, text='연관 검색어 수집 중...') {
  isLoading=active;
  loadingText.textContent=text;
  loadingEl.classList.toggle('active',active);
  document.getElementById('searchBtn').disabled=active;
  if (!active) document.getElementById('loading-progress').textContent='';
}

// ── 레전드 동적 업데이트 ─────────────────────────────
function updateLegend(keyword) {
  const items = [keyword||'검색어','1차 연관','2차 연관','3차 연관'];
  const wrap = document.getElementById('mm-legend');
  wrap.innerHTML = items.map((t,i)=>
    `<div class="mm-legend-item">
      <div class="mm-dot" style="background:${DEPTH_COLORS[i]}"></div>${t}
    </div>`
  ).join('');
}

// ── 검색 시작 ────────────────────────────────────────
async function startSearch(keyword) {
  if (!keyword||isLoading) return;
  keyword=keyword.trim();

  nodes=[]; links=[]; nodeIds.clear();
  linksG.selectAll('*').remove();
  nodesG.selectAll('*').remove();
  infoPanelEl.classList.remove('visible');
  emptyState.classList.add('hidden');
  document.getElementById('bar-chart').innerHTML='';
  document.getElementById('stats-kw').textContent='';

  setLoading(true,`"${keyword}" 수집 중...`);
  updateLegend(keyword);

  const rootId=keyword.toLowerCase();
  nodeIds.add(rootId);
  const {w,h}=getSvgSize(); width=w; height=h;
  nodes.push({id:rootId,label:keyword,depth:0,
    totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0,
    fx:width/2,fy:height/2});

  try {
    // 1차 먼저 → stats 패널 선행 표시
    const firstLevel = await fetchNaverKeywords(keyword);
    if (firstLevel.length>0) renderStats(keyword, firstLevel);
    // 전수 BFS
    await collectAll(keyword,rootId);
  } catch(e) {
    showToast('오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    setLoading(false);
    if (nodes.length<=1) {
      showToast('연관 검색어를 찾지 못했습니다. 다른 키워드를 시도해보세요.');
    } else {
      updateGraph();
      showToast(`총 ${nodes.length}개 키워드 로드 완료`);
      // 마인드맵 섹션으로 스크롤
      document.querySelector('.mindmap-section').scrollIntoView({behavior:'smooth'});
    }
  }
}

// ── 이벤트 ──────────────────────────────────────────
document.getElementById('searchBtn').addEventListener('click',()=>{
  const kw=document.getElementById('searchInput').value.trim();
  if(kw) startSearch(kw);
});
document.getElementById('searchInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const kw=e.target.value.trim();if(kw)startSearch(kw);}
});
window.addEventListener('resize',()=>{
  const {w,h}=getSvgSize(); width=w; height=h;
  simulation.force('center',d3.forceCenter(w/2,h/2)).alpha(0.1).restart();
});
svg.call(zoom.transform,d3.zoomIdentity);
renderGenderAge(null);
