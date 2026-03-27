// ── 설정 ──────────────────────────────────────────
const DEPTH_COLORS  = ['#1a56db', '#22c55e', '#f59e0b', '#8b5cf6'];
const DEPTH_RADIUS  = [44, 32, 24, 18];
const DEPTH_OPACITY = [1, 0.92, 0.85, 0.80];
const MAX_DEPTH     = 3;
const BRANCH_LIMITS = [Infinity, 8, 4, 2];

// ── Naver Search Ads API (키워드 + 검색량) ──────────

function wrapStrings(arr) {
  return arr.map(k => typeof k === 'string'
    ? {keyword:k,totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0}
    : k);
}

function parseRelatedFromHtml(html) {
  if (!html || html.length < 500) return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const SELS = ['a[href*="related_query"]','.lst_related_srch .tit','.related_srch a',
                  '#nx_related_kwd a','[class*="relatedKeyword"] a'];
    for (const s of SELS) {
      const kws=[...doc.querySelectorAll(s)].map(e=>e.textContent.trim()).filter(k=>k.length>=2&&k.length<=40);
      if (kws.length>=2) return [...new Set(kws)].slice(0,10);
    }
    for (const s of doc.querySelectorAll('script')) {
      const m=s.textContent.match(/"relatedKeywords?":\s*\[([^\]]+)\]/);
      if (m){const kws=[...m[1].matchAll(/"([^"]{2,40})"/g)].map(x=>x[1]);if(kws.length>=2)return kws.slice(0,10);}
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

async function fetchViaProxy(keyword) {
  const urls=[
    'https://m.search.naver.com/search.naver?where=m&query='+encodeURIComponent(keyword),
    'https://search.naver.com/search.naver?query='+encodeURIComponent(keyword),
  ];
  for (const u of urls) {
    try {
      const r=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(u),{signal:AbortSignal.timeout(9000)});
      if(r.ok){const kws=parseRelatedFromHtml(await r.text());if(kws.length>=2)return kws;}
    } catch(e){}
  }
  return [];
}

function fetchAutocomplete(keyword) {
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
    if(r.ok){const d=await r.json();if(d.keywords?.length>=2)return d.keywords;}
  } catch(e){}
  try {const k=await fetchViaProxy(keyword);if(k.length>=2)return wrapStrings(k);} catch(e){}
  return wrapStrings(await fetchAutocomplete(keyword));
}

// ── DataLab 추이 API ─────────────────────────────────
async function fetchTrend(keyword) {
  try {
    const r=await fetch('/api/trend?keyword='+encodeURIComponent(keyword),{signal:AbortSignal.timeout(12000)});
    if(r.ok) return r.json();
  } catch(e){}
  return null;
}

// ── 수 포맷 (건 단위, K 없음) ──────────────────────────
function fmtN(n) { return (n||0).toLocaleString()+'건'; }
function fmtCtr(v) { return (v||0)+'%'; }

// ── 통계 카드 렌더 (TOP 5: 검색어 + 후순위 4개) ─────────
function renderStats(keyword, items) {
  document.getElementById('stats-kw-badge').textContent = keyword;
  document.getElementById('trend-panel-kw').textContent = keyword;
  const wrap = document.getElementById('kw-cards');
  wrap.innerHTML = '';

  // 검색어 자체를 첫 번째로 — 나머지 4개 상위 연관어
  const top4 = items.filter(d => d.keyword !== keyword).slice(0, 4);
  // 검색어 stats는 items에서 찾거나 zero
  const rootItem = items.find(d=>d.keyword===keyword) || {keyword, totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0};
  const cards = [rootItem, ...top4];

  const maxVol = Math.max(...cards.map(d=>d.pcVol+d.mobileVol), 1);

  cards.forEach((d, i) => {
    const pcPct  = Math.max(1, Math.round((d.pcVol / maxVol) * 100));
    const mobPct = Math.max(1, Math.round((d.mobileVol / maxVol) * 100));
    const clicks = (d.pcClicks||0) + (d.mobileClicks||0);

    const card = document.createElement('div');
    card.className = 'kw-card';
    card.innerHTML = `
      <div class="card-title-row">
        <div class="rank-badge ${i===0?'rank-1':''}">${i+1}</div>
        <div class="card-kw-name">${d.keyword}</div>
      </div>
      <div class="card-bars">
        <div class="card-bar-row">
          <span class="card-bar-label pc">PC</span>
          <div class="card-bar-track"><div class="card-bar-fill pc" style="width:${pcPct}%"></div></div>
          <span class="card-bar-val">${(d.pcVol||0).toLocaleString()}</span>
        </div>
        <div class="card-bar-row">
          <span class="card-bar-label mo">MO</span>
          <div class="card-bar-track"><div class="card-bar-fill mo" style="width:${mobPct}%"></div></div>
          <span class="card-bar-val">${(d.mobileVol||0).toLocaleString()}</span>
        </div>
      </div>
      <div class="card-detail">
        <table class="card-detail-table">
          <thead><tr><th></th><th>검색량</th><th>클릭율</th></tr></thead>
          <tbody>
            <tr><td>PC</td><td><b>${fmtN(d.pcVol)}</b></td><td>${fmtCtr(d.pcCtr)}</td></tr>
            <tr><td>MO</td><td><b>${fmtN(d.mobileVol)}</b></td><td>${fmtCtr(d.mobileCtr)}</td></tr>
          </tbody>
        </table>
      </div>`;
    wrap.appendChild(card);
  });
}

// ── 추이 라인차트 (D3) ────────────────────────────────
function renderTrendChart(trendData) {
  const container = document.getElementById('trend-chart');
  container.innerHTML = '';

  if (!trendData || trendData.length === 0) {
    container.outerHTML = '<div class="trend-placeholder">DataLab API 데이터 없음<span style="font-size:11px;display:block;margin-top:4px">Vercel 환경변수: NAVER_DATALAB_CLIENT_ID / SECRET 확인</span></div>';
    return;
  }

  const margin = {top:10, right:20, bottom:36, left:36};
  const W = container.clientWidth || 400;
  const H = 220;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select(container)
    .append('svg').attr('width', W).attr('height', H)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(trendData.map(d=>d.period)).range([0,w]).padding(0.1);
  const y = d3.scaleLinear().domain([0, d3.max(trendData, d=>Math.max(d.pc,d.mo))*1.15]).range([h,0]).nice();

  // 격자선
  svg.append('g').attr('class','grid').call(
    d3.axisLeft(y).tickSize(-w).tickFormat('').ticks(4)
  ).selectAll('line').attr('stroke','#e5e7eb').attr('stroke-dasharray','3,3');
  svg.select('.grid .domain').remove();

  // X축
  svg.append('g').attr('transform',`translate(0,${h})`).call(
    d3.axisBottom(x).tickFormat(d=>d.slice(2)) // YY-MM
  ).selectAll('text').attr('font-size',10).attr('fill','#6b7280');
  // Y축
  svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d=>d)).selectAll('text').attr('font-size',10).attr('fill','#6b7280');
  svg.select('.domain').attr('stroke','#e5e7eb');

  const xPos = d => x(d.period) + x.bandwidth()/2;

  // MO 라인
  const lineMo = d3.line().x(xPos).y(d=>y(d.mo)).curve(d3.curveMonotoneX);
  svg.append('path').datum(trendData).attr('d',lineMo).attr('fill','none')
    .attr('stroke','#16a34a').attr('stroke-width',2.5);
  svg.selectAll('.dot-mo').data(trendData).enter().append('circle')
    .attr('cx',xPos).attr('cy',d=>y(d.mo)).attr('r',3.5)
    .attr('fill','#16a34a').attr('stroke','#fff').attr('stroke-width',1.5);

  // PC 라인
  const linePc = d3.line().x(xPos).y(d=>y(d.pc)).curve(d3.curveMonotoneX);
  svg.append('path').datum(trendData).attr('d',linePc).attr('fill','none')
    .attr('stroke','#1a56db').attr('stroke-width',2.5);
  svg.selectAll('.dot-pc').data(trendData).enter().append('circle')
    .attr('cx',xPos).attr('cy',d=>y(d.pc)).attr('r',3.5)
    .attr('fill','#1a56db').attr('stroke','#fff').attr('stroke-width',1.5);

  // 범례
  const leg = svg.append('g').attr('transform',`translate(${w-110},0)`);
  [['#1a56db','desktop'],['#16a34a','mobile']].forEach(([c,l],i)=>{
    const g=leg.append('g').attr('transform',`translate(0,${i*18})`);
    g.append('circle').attr('cx',6).attr('cy',6).attr('r',5).attr('fill',c);
    g.append('text').attr('x',14).attr('y',10).attr('font-size',11).attr('fill','#6b7280').text(l);
  });
}

// ── 성별 비율 렌더 ────────────────────────────────────
function renderGenderAge(data) {
  const gs = document.getElementById('gender-section');
  const as = document.getElementById('age-section');

  if (data?.gender) {
    const {male, female} = data.gender;
    gs.innerHTML = `
      <div class="ga-title">성별 검색 비율</div>
      <div class="gender-bar">
        <div class="gender-segment" style="width:${male}%;background:#1a56db">${male}%</div>
        <div class="gender-segment" style="width:${female}%;background:#ec4899">${female}%</div>
      </div>
      <div class="gender-labels">
        <span class="gender-label">남성 <b>${male}%</b></span>
        <span class="gender-label">여성 <b>${female}%</b></span>
      </div>`;
  } else {
    gs.innerHTML = `<div class="ga-title">성별 검색 비율</div>
      <div class="ga-placeholder">Vercel에 NAVER_DATALAB_CLIENT_ID / SECRET 입력 후 표시됩니다</div>`;
  }

  as.innerHTML = `<div class="ga-title">연령별 검색 비율</div>
    <div class="ga-placeholder">DataLab 연령별 API 추가 연동 예정</div>`;
}

// ── 노드 반경 ─────────────────────────────────────────
function nodeRadius(d) {
  const base = DEPTH_RADIUS[Math.min(d.depth,3)];
  const textMin = Math.max(base, d.label.length * 5.8 / 2 + 12);
  if (!d.totalVol) return textMin;
  const same=nodes.filter(n=>n.depth===d.depth&&n.totalVol>0);
  if (!same.length) return textMin;
  const maxV=Math.max(...same.map(n=>n.totalVol),1);
  const scale=Math.log1p(d.totalVol)/Math.log1p(maxV);
  return Math.max(textMin, base+(scale-0.5)*14);
}

function linkWidth(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t?.totalVol) return 1.5;
  const same=nodes.filter(n=>n.depth===t.depth&&n.totalVol>0);
  const maxV=Math.max(...same.map(n=>n.totalVol),1);
  return 1+Math.log1p(t.totalVol)/Math.log1p(maxV)*5;
}

function linkColor(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t?.totalVol) return 'rgba(160,174,192,0.3)';
  const same=nodes.filter(n=>n.depth===t.depth&&n.totalVol>0);
  const maxV=Math.max(...same.map(n=>n.totalVol),1);
  const sc=Math.log1p(t.totalVol)/Math.log1p(maxV);
  return `rgba(99,102,241,${(0.15+sc*0.5).toFixed(2)})`;
}

// ── D3 초기화 ─────────────────────────────────────────
const svg = d3.select('#graph');
const defs = svg.append('defs');

const glow=defs.append('filter').attr('id','glow').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
glow.append('feGaussianBlur').attr('stdDeviation','5').attr('result','coloredBlur');
const fm=glow.append('feMerge');
fm.append('feMergeNode').attr('in','coloredBlur');
fm.append('feMergeNode').attr('in','SourceGraphic');

function lighten(hex,a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,Math.round(r+(255-r)*a))},${Math.min(255,Math.round(g+(255-g)*a))},${Math.min(255,Math.round(b+(255-b)*a))})`;
}
DEPTH_COLORS.forEach((c,i)=>{
  const gr=defs.append('radialGradient').attr('id',`grad-${i}`).attr('cx','35%').attr('cy','35%').attr('r','65%');
  gr.append('stop').attr('offset','0%').attr('stop-color',lighten(c,0.35)).attr('stop-opacity',DEPTH_OPACITY[i]);
  gr.append('stop').attr('offset','100%').attr('stop-color',c).attr('stop-opacity',DEPTH_OPACITY[i]);
});

const zoomG=svg.append('g').attr('id','zoom-layer');
const zoom=d3.zoom().scaleExtent([0.1,5]).on('zoom',e=>zoomG.attr('transform',e.transform));
svg.call(zoom).on('dblclick.zoom',null);

const linksG=zoomG.append('g').attr('id','links');
const nodesG=zoomG.append('g').attr('id','nodes');

const simulation=d3.forceSimulation()
  .force('link',d3.forceLink().id(d=>d.id).distance(d=>100+(d.target.depth||0)*55).strength(0.55))
  .force('charge',d3.forceManyBody().strength(-380).distanceMax(600))
  .force('center',d3.forceCenter(400,300))
  .force('collision',d3.forceCollide().radius(d=>nodeRadius(d)+14))
  .alphaDecay(0.025);

let nodes=[],links=[];
const nodeIds=new Set();
let isLoading=false;

// ── 그래프 렌더 ───────────────────────────────────────
function updateGraph() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||800, H=el.clientHeight||600;

  const link=linksG.selectAll('line').data(links,d=>`${d.source?.id||d.source}→${d.target?.id||d.target}`);
  link.enter().append('line').attr('stroke-linecap','round');
  link.exit().remove();

  const node=nodesG.selectAll('g.node-group').data(nodes,d=>d.id);
  const enter=node.enter().append('g').attr('class','node-group')
    .style('opacity',0).style('cursor','pointer')
    .call(d3.drag()
      .on('start',(e,d)=>{if(!e.active)simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
      .on('drag', (e,d)=>{d.fx=e.x;d.fy=e.y;})
      .on('end',  (e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}))
    .on('mouseenter',onHover).on('mouseleave',onLeave).on('click',onClick);

  enter.append('circle').attr('class','node-glow')
    .attr('r',d=>nodeRadius(d)+10).attr('fill',d=>DEPTH_COLORS[Math.min(d.depth,3)])
    .attr('fill-opacity',0.07).attr('stroke','none');

  enter.append('circle').attr('class','node-circle')
    .attr('r',d=>nodeRadius(d))
    .attr('fill',d=>`url(#grad-${Math.min(d.depth,3)})`)
    .attr('stroke','rgba(255,255,255,0.7)')
    .attr('stroke-width',d=>d.depth===0?3:1.5);

  // 텍스트 줄바꿈 (tspan)
  enter.each(function(d) {
    const r=nodeRadius(d);
    const maxW=r*1.75;
    const fs=d.depth===0?13:d.depth===1?11:10;
    const cpl=Math.max(2,Math.floor(maxW/(fs*0.62)));
    const chars=[...d.label];
    const lines=[];
    for(let i=0;i<chars.length;i+=cpl) lines.push(chars.slice(i,i+cpl).join(''));
    const lh=fs+2;
    const startY=-(lines.length-1)*lh/2;
    const txt=d3.select(this).append('text').attr('class','node-label')
      .attr('text-anchor','middle').attr('fill','#111827')
      .attr('stroke','rgba(255,255,255,0.92)').attr('stroke-width',3).attr('paint-order','stroke')
      .attr('font-size',`${fs}px`).attr('font-weight',d.depth===0?'700':'600')
      .attr('font-family','-apple-system,BlinkMacSystemFont,system-ui,sans-serif')
      .attr('pointer-events','none');
    lines.forEach((l,i)=>{
      txt.append('tspan').attr('x',0).attr('dy',i===0?startY:lh).text(l);
    });
  });

  enter.transition().duration(500).ease(d3.easeCubicOut).style('opacity',1);
  node.exit().remove();

  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.force('collision').radius(d=>nodeRadius(d)+14);
  simulation.force('center',d3.forceCenter(W/2,H/2));
  simulation.alpha(0.5).restart();

  linksG.selectAll('line')
    .attr('stroke',d=>linkColor(d))
    .attr('stroke-width',d=>linkWidth(d));

  simulation.on('tick',()=>{
    linksG.selectAll('line')
      .attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
      .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    nodesG.selectAll('g.node-group').attr('transform',d=>`translate(${d.x},${d.y})`);
  });
}

// ── 호버 / 클릭 ───────────────────────────────────────
const tooltipEl=document.getElementById('tooltip');
const infoPanelEl=document.getElementById('info-panel');

function onHover(e,d) {
  const r=nodeRadius(d);
  d3.select(this).select('.node-circle').attr('filter','url(#glow)').transition().duration(150).attr('r',r*1.12);
  d3.select(this).select('.node-glow').transition().duration(150).attr('fill-opacity',0.18);
  tooltipEl.textContent=d.label;
  tooltipEl.style.left=(e.clientX+14)+'px';tooltipEl.style.top=(e.clientY-8)+'px';
  tooltipEl.classList.add('visible');
}
function onLeave(e,d) {
  const r=nodeRadius(d);
  d3.select(this).select('.node-circle').attr('filter',null).transition().duration(150).attr('r',r);
  d3.select(this).select('.node-glow').transition().duration(150).attr('fill-opacity',0.07);
  tooltipEl.classList.remove('visible');
}
function onClick(e,d) {
  e.stopPropagation();
  if(isLoading) return;
  const clicks=(d.pcClicks||0)+(d.mobileClicks||0);
  infoPanelEl.innerHTML=`
    <strong>${d.label}</strong>
    <span style="font-size:11px;color:#6b7280">${d.depth}차 연관어</span>
    ${d.totalVol?`<div class="info-metric">
      <div class="info-metric-row"><span class="k">PC 검색</span><span class="v" style="color:#1a56db">${fmtN(d.pcVol)}</span></div>
      <div class="info-metric-row"><span class="k">MO 검색</span><span class="v" style="color:#16a34a">${fmtN(d.mobileVol)}</span></div>
      <div class="info-metric-row"><span class="k">클릭수</span><span class="v">${fmtN(clicks)}</span></div>
      <div class="info-metric-row"><span class="k">PC CTR</span><span class="v">${fmtCtr(d.pcCtr)}</span></div>
      <div class="info-metric-row"><span class="k">MO CTR</span><span class="v">${fmtCtr(d.mobileCtr)}</span></div>
    </div>`:''}
    <div class="hint" onclick="window.reSearch('${d.label.replace(/'/g,"\\'")}')">이 키워드로 새 검색 →</div>`;
  infoPanelEl.classList.add('visible');
}
svg.on('click',()=>infoPanelEl.classList.remove('visible'));
window.reSearch=kw=>{document.getElementById('searchInput').value=kw;startSearch(kw);};

// ── BFS 전수 수집 ─────────────────────────────────────
async function collectAll(rootKeyword, rootId) {
  const queue=[{kw:rootKeyword,parentId:rootId,depth:1}];
  let processed=0;
  while(queue.length>0&&nodes.length<300) {
    const batch=queue.splice(0,5);
    const results=await Promise.allSettled(batch.map(it=>fetchNaverKeywords(it.kw)));
    results.forEach((r,i)=>{
      processed++;
      document.getElementById('loading-progress').textContent=`${processed}개 수집 완료`;
      if(r.status!=='fulfilled') return;
      const {parentId,depth}=batch[i];
      r.value.slice(0,BRANCH_LIMITS[depth]??2).forEach(item=>{
        const id=item.keyword.toLowerCase().trim();
        if(!id) return;
        if(nodeIds.has(id)){
          if(!links.find(l=>(l.source?.id||l.source)===parentId&&(l.target?.id||l.target)===id))
            links.push({source:parentId,target:id});
          return;
        }
        nodeIds.add(id);
        nodes.push({id,label:item.keyword,depth,
          totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
          pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
          pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0});
        links.push({source:parentId,target:id});
        if(depth<MAX_DEPTH) queue.push({kw:item.keyword,parentId:id,depth:depth+1});
      });
    });
  }
}

// ── UI 유틸 ───────────────────────────────────────────
const loadingEl=document.getElementById('loading');
const loadingText=document.getElementById('loading-text');
const emptyState=document.getElementById('empty-state');
const toastEl=document.getElementById('toast');
let toastTimer;

function showToast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent=msg;toastEl.classList.add('show');
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);
}
function setLoading(active,text='연관 검색어 수집 중...') {
  isLoading=active;
  loadingText.textContent=text;
  loadingEl.classList.toggle('active',active);
  document.getElementById('searchBtn').disabled=active;
  if(!active) document.getElementById('loading-progress').textContent='';
}

function updateLegend(keyword) {
  const items=[keyword||'검색어','1차 연관','2차 연관','3차 연관'];
  const wrap=document.getElementById('mm-legend');
  wrap.innerHTML=items.map((t,i)=>
    `<div class="mm-legend-item"><div class="mm-dot" style="background:${DEPTH_COLORS[i]}"></div>${t}</div>`
  ).join('');
}

// ── 검색 시작 ─────────────────────────────────────────
async function startSearch(keyword) {
  if(!keyword||isLoading) return;
  keyword=keyword.trim();

  nodes=[];links=[];nodeIds.clear();
  linksG.selectAll('*').remove();nodesG.selectAll('*').remove();
  infoPanelEl.classList.remove('visible');
  emptyState.classList.add('hidden');
  document.getElementById('kw-cards').innerHTML='';
  document.getElementById('stats-kw-badge').textContent='';
  document.getElementById('trend-chart').innerHTML='';

  setLoading(true,`"${keyword}" 수집 중...`);
  updateLegend(keyword);

  const rootId=keyword.toLowerCase();
  nodeIds.add(rootId);
  const el=document.getElementById('graph');
  const W=el.clientWidth||800,H=el.clientHeight||600;
  nodes.push({id:rootId,label:keyword,depth:0,
    totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0,
    fx:W/2,fy:H/2});

  try {
    // 병렬: 1차 키워드 + DataLab 추이
    const [firstLevel, trendData] = await Promise.all([
      fetchNaverKeywords(keyword),
      fetchTrend(keyword),
    ]);

    if(firstLevel.length>0) renderStats(keyword, firstLevel);
    renderTrendChart(trendData?.trend || null);
    renderGenderAge(trendData);

    await collectAll(keyword,rootId);
  } catch(e) {
    showToast('오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    setLoading(false);
    if(nodes.length<=1) {
      showToast('연관 검색어를 찾지 못했습니다. 다른 키워드를 시도해보세요.');
    } else {
      updateGraph();
      showToast(`총 ${nodes.length}개 키워드 로드 완료`);
      document.querySelector('.mindmap-outer').scrollIntoView({behavior:'smooth'});
    }
  }
}

// ── 이벤트 ────────────────────────────────────────────
document.getElementById('searchBtn').addEventListener('click',()=>{
  const kw=document.getElementById('searchInput').value.trim();
  if(kw) startSearch(kw);
});
document.getElementById('searchInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const kw=e.target.value.trim();if(kw)startSearch(kw);}
});
window.addEventListener('resize',()=>{
  const el=document.getElementById('graph');
  simulation.force('center',d3.forceCenter(el.clientWidth/2,el.clientHeight/2)).alpha(0.1).restart();
});
svg.call(zoom.transform,d3.zoomIdentity);
renderGenderAge(null);
