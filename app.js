// ── 설정 ──────────────────────────────────────────
const ROOT_COLOR     = '#4F46E5';   // Apple System Indigo
// 카테고리 halo 배경 색
const CLUSTER_COLORS = ['#6366F1','#10B981','#F97316','#8B5CF6','#EC4899']; // Indigo, Emerald, Orange, Purple, Pink
// 노드 fill 색 (역할별)
const HUB_COLOR      = '#10B981';   // Emerald (허브)
const NON_HUB_COLOR  = '#38BDF8';   // Light Blue (서브 연관)
const D2_COLOR       = '#FBBF24';   // Amber (2차)
const D3_COLOR       = '#CBD5E1';   // Slate 300 (3차)

// 레전드용
const DEPTH_COLORS   = [ROOT_COLOR, HUB_COLOR, D2_COLOR, D3_COLOR];
const DEPTH_OPACITY  = [1, 1, 1, 1];

const MAX_HUB        = 5;
const MAX_D1         = 9;
const MAX_D2_PER     = 5;
const MAX_D3_PER     = 2;
const MAX_LINKS_SHOW = 60;
const MAX_DEPTH      = 3;
let currentClusters  = [];
let currentKeyword   = '';

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
  const wrap = document.getElementById('kw-cards');
  wrap.innerHTML = '';

  // 검색어 자체를 첫 번째로 — 나머지 4개 상위 연관어 (정규화 비교로 중복 방지)
  const normKw = keyword.toLowerCase().trim();
  const rootItem = items.find(d=>d.keyword.toLowerCase().trim()===normKw) || {keyword, totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0};
  const top4 = items.filter(d => d.keyword.toLowerCase().trim()!==normKw).slice(0, 4);
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

// ── DataLab 상대지수 → 절대값 변환 ──────────────────
// DataLab 상대 지수를 Search Ads API 절대값으로 변환
// 기준: 마지막 DataLab 데이터포인트 = Search Ads API 현재 월 절대값 (1:1 anchoring)
// 나머지 월 = DataLab 상대 비율로 비례 계산
// ※ Search Ads API는 현재 월 1개 값만 제공 → 과거 월은 DataLab 비율로 역산한 추정치
function scaleTrend(trend, pcAbs, moAbs) {
  if (!trend?.length) return trend;
  const last = trend[trend.length - 1];
  const pcRef = last?.pc || 1, moRef = last?.mo || 1;
  return trend.map(d=>({
    period: d.period,
    pc: pcAbs > 0 ? Math.round(d.pc / pcRef * pcAbs) : Math.round(d.pc),
    mo: moAbs > 0 ? Math.round(d.mo / moRef * moAbs) : Math.round(d.mo),
  }));
}
let currentTrendData=null;
function copyTrendData() {
  if (!currentTrendData?.length){showToast('복사할 데이터가 없습니다');return;}
  const hdr='\t'+currentTrendData.map(d=>d.period).join('\t');
  const pc='PC\t'+currentTrendData.map(d=>d.pc).join('\t');
  const mo='MO\t'+currentTrendData.map(d=>d.mo).join('\t');
  navigator.clipboard.writeText([hdr,pc,mo].join('\n'))
    .then(()=>showToast('복사 완료 — Excel에 붙여넣기 하세요'))
    .catch(()=>showToast('복사 실패 — 브라우저 권한 확인'));
}

// ── 추이 라인차트 (D3) ────────────────────────────────
function renderTrendChart(trendData, pcAbsNow, moAbsNow) {
  const container = document.getElementById('trend-chart');
  const legendEl  = document.getElementById('trend-legend');
  container.innerHTML = '';
  if (legendEl) legendEl.innerHTML = '';

  if (!trendData || trendData.length === 0) {
    container.innerHTML = '<div class="trend-placeholder">DataLab API 데이터 없음<span style="font-size:11px;display:block;margin-top:4px">Vercel 환경변수: NAVER_DATALAB_CLIENT_ID / SECRET 확인</span></div>';
    return;
  }

  // Search Ads API 절대값 기준으로 스케일링 (마지막 월 = Search Ads API 정확값)
  const data = scaleTrend(trendData, pcAbsNow||0, moAbsNow||0);
  currentTrendData = data;

  if (legendEl) legendEl.innerHTML =
    `<div class="tl-item"><div class="tl-dot" style="background:#1E40AF"></div>PC 검색수</div>
     <div class="tl-item"><div class="tl-dot" style="background:#16a34a"></div>Mobile 검색수</div>`;

  const margin={top:12,right:16,bottom:36,left:60};
  const W=container.clientWidth||420, H=Math.max(200, container.clientHeight||230);
  const w=W-margin.left-margin.right, h=H-margin.top-margin.bottom;

  const svg=d3.select(container).append('svg')
    .attr('width','100%').attr('height',H).attr('viewBox',`0 0 ${W} ${H}`)
    .append('g').attr('transform',`translate(${margin.left},${margin.top})`);

  const x=d3.scaleBand().domain(data.map(d=>d.period)).range([0,w]).padding(0.1);
  const yMax=d3.max(data,d=>Math.max(d.pc,d.mo))*1.18||100;
  const y=d3.scaleLinear().domain([0,yMax]).range([h,0]).nice();
  const xPos=d=>x(d.period)+x.bandwidth()/2;

  svg.append('g').attr('class','grid').call(
    d3.axisLeft(y).tickSize(-w).tickFormat('').ticks(5)
  ).selectAll('line').attr('stroke','#e5e7eb').attr('stroke-dasharray','3,3');
  svg.select('.grid .domain').remove();

  const xAx=svg.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).tickFormat(d=>d.slice(2)));
  xAx.selectAll('text').attr('font-size',10).attr('fill','#6b7280');
  xAx.select('.domain').attr('stroke','#e5e7eb');

  // Y축: 실제 검색량 숫자 (만/천 단위 포맷)
  const yFmt=v=>v>=10000?(v/10000).toFixed(1)+'만':v>=1000?(v/1000).toFixed(0)+'천':v;
  const yAx=svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(yFmt));
  yAx.selectAll('text').attr('font-size',10).attr('fill','#6b7280');
  yAx.select('.domain').attr('stroke','#e5e7eb');

  [['mo','#16a34a'],['pc','#1E40AF']].forEach(([k,c])=>{
    svg.append('path').datum(data)
      .attr('d',d3.area().x(xPos).y0(h).y1(d=>y(d[k])).curve(d3.curveMonotoneX))
      .attr('fill',c).attr('fill-opacity',0.13);
    svg.append('path').datum(data)
      .attr('d',d3.line().x(xPos).y(d=>y(d[k])).curve(d3.curveMonotoneX))
      .attr('fill','none').attr('stroke',c).attr('stroke-width',2.5);
    svg.selectAll(`.dot-${k}`).data(data).enter().append('circle')
      .attr('cx',xPos).attr('cy',d=>y(d[k])).attr('r',3.5)
      .attr('fill',c).attr('stroke','#fff').attr('stroke-width',1.5);
  });

  // ── 호버 툴팁 ──
  const hoverG = svg.append('g').attr('pointer-events','none').style('display','none');
  hoverG.append('line').attr('class','h-line').attr('y1',0).attr('y2',h)
    .attr('stroke','#cbd5e1').attr('stroke-width',1.5).attr('stroke-dasharray','4,3');
  hoverG.append('circle').attr('class','h-dot-pc').attr('r',6).attr('fill','#1E40AF').attr('stroke','#fff').attr('stroke-width',2);
  hoverG.append('circle').attr('class','h-dot-mo').attr('r',6).attr('fill','#16a34a').attr('stroke','#fff').attr('stroke-width',2);

  const chartTip = document.getElementById('chart-tooltip');
  svg.append('rect').attr('width',w).attr('height',h).attr('fill','none').attr('pointer-events','all')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      let ni=0, minD=Infinity;
      data.forEach((d,i)=>{const cx=xPos(d);const dist=Math.abs(cx-mx);if(dist<minD){minD=dist;ni=i;}});
      const d=data[ni]; const cx=xPos(d);
      hoverG.style('display',null);
      hoverG.select('.h-line').attr('x1',cx).attr('x2',cx);
      hoverG.select('.h-dot-pc').attr('cx',cx).attr('cy',y(d.pc));
      hoverG.select('.h-dot-mo').attr('cx',cx).attr('cy',y(d.mo));
      const rect=container.getBoundingClientRect();
      const ttx=rect.left+margin.left+cx+16;
      const tty=rect.top+margin.top+Math.min(y(d.pc),y(d.mo))-12;
      chartTip.innerHTML=`<div class="ct-date">${d.period}</div>
        <div class="ct-row"><span class="ct-dot" style="background:#1E40AF"></span>PC<b>약 ${d.pc.toLocaleString()}건</b></div>
        <div class="ct-row"><span class="ct-dot" style="background:#16a34a"></span>Mobile<b>약 ${d.mo.toLocaleString()}건</b></div>`;
      chartTip.style.left=Math.min(ttx,window.innerWidth-180)+'px';
      chartTip.style.top=Math.max(tty,60)+'px';
      chartTip.classList.add('visible');
    })
    .on('mouseleave',()=>{hoverG.style('display','none');chartTip.classList.remove('visible');});
}

// ── 성별/연령 렌더 ────────────────────────────────────
function renderGenderAge(data) {
  const gs = document.getElementById('gender-section');
  const as = document.getElementById('age-section');

  if (data?.gender) {
    const g = data.gender;
    gs.innerHTML = `
      <div class="ga-title">성별 검색 비율</div>
      <div class="gender-bar-wrap">
        <div class="gender-seg male" style="width:${g.male}%">
          <span class="gender-seg-label">남성 ${g.male}%</span>
        </div>
        <div class="gender-seg female" style="width:${g.female}%">
          <span class="gender-seg-label">여성 ${g.female}%</span>
        </div>
      </div>
      <div class="gender-device-wrap">
        <div class="gender-device-col">
          <div class="gender-device-title">PC</div>
          <div class="gender-device-bar">
            <div class="gender-device-seg male" style="width:${g.malePc}%"></div>
            <div class="gender-device-seg female" style="width:${g.femalePc}%"></div>
          </div>
          <div class="gender-device-vals">
            <span class="male-val">남 ${g.malePc}%</span>
            <span class="female-val">여 ${g.femalePc}%</span>
          </div>
        </div>
        <div class="gender-device-col">
          <div class="gender-device-title">Mobile</div>
          <div class="gender-device-bar">
            <div class="gender-device-seg male" style="width:${g.maleMo}%"></div>
            <div class="gender-device-seg female" style="width:${g.femaleMo}%"></div>
          </div>
          <div class="gender-device-vals">
            <span class="male-val">남 ${g.maleMo}%</span>
            <span class="female-val">여 ${g.femaleMo}%</span>
          </div>
        </div>
      </div>`;
  } else {
    gs.innerHTML = `<div class="ga-title">성별 검색 비율</div>
      <div class="ga-placeholder">Vercel에 NAVER_DATALAB_CLIENT_ID / SECRET 입력 후 표시됩니다</div>`;
  }

  if (data?.ages) {
    const entries = Object.entries(data.ages);
    const maxPct = Math.max(...entries.map(([,v])=>v), 1);
    as.innerHTML = `
      <div class="ga-title">연령별 검색 비율</div>
      <div class="age-bars">
        ${entries.map(([label,pct])=>`
          <div class="age-row">
            <div class="age-label">${label}</div>
            <div class="age-track"><div class="age-fill" style="width:${Math.round(pct/maxPct*100)}%"></div></div>
            <div class="age-val">${pct}%</div>
          </div>`).join('')}
      </div>`;
  } else {
    as.innerHTML = `<div class="ga-title">연령별 검색 비율</div>
      <div class="ga-placeholder">Vercel에 NAVER_DATALAB_CLIENT_ID / SECRET 입력 후 표시됩니다</div>`;
  }
}

// ── 노드 반경 (검색량 비례 — 같은 depth 내 log 스케일) ────
// base: 역할별 기본 크기 / range: ±range 범위로 검색량 비례 변화
function nodeRadius(d) {
  const base  = d.depth===0?56:d.isHub?46:d.depth===1?22:d.depth===2?26:15;
  const range = d.depth===0?0:d.isHub?20:d.depth===1?8:d.depth===2?12:6;
  if (!d.totalVol || range===0 || !nodes.length) return base;
  const peers = nodes.filter(n => d.isHub ? n.isHub : (n.depth===d.depth && !n.isHub));
  const maxVol = Math.max(...peers.map(n=>n.totalVol), 1);
  const scale  = Math.log1p(d.totalVol) / Math.log1p(maxVol); // 0~1
  // 검색량 0인 노드는 최소 크기, 최대 검색량은 base+range
  return Math.round((base - range) + scale * range * 2);
}

function linkWidth(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t) return 1;
  if (t.isHub)     return 2.2;
  if (t.depth===1) return 1.0;
  if (t.depth===2) return 1.5;
  if (t.depth===3) return 0.8;
  return 1;
}

function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
// 링크 색: 노드 역할 기반
function linkColor(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t) return 'rgba(148,163,184,0.20)';
  if (t.isHub)     return hexToRgba(HUB_COLOR, 0.40);
  if (t.depth===1) return 'rgba(134,239,172,0.35)';
  if (t.depth===2) return hexToRgba(D2_COLOR, 0.35);
  if (t.depth===3) return hexToRgba(D3_COLOR, 0.28);
  return 'rgba(148,163,184,0.20)';
}

// ── 연관성 점수 (API 순위 × 검색량) ─────────────────────
function relevanceScore(item, idx) {
  const posScore = 1 / (idx + 1);
  const volScore = Math.log1p(item.totalVol||0) / Math.log1p(500000);
  return +(posScore * 0.55 + volScore * 0.45).toFixed(4);
}

// currentClusters는 collectAll 내에서 직접 생성 (buildHubClusters 제거)

// ── 클러스터 헐(hull) 패스 — 부드러운 곡선 ────────────────
function hullPath(pts, pad) {
  if(!pts.length) return '';
  if(pts.length===1){
    const [px,py]=pts[0];
    return `M${px-pad},${py} A${pad},${pad} 0 1,0 ${px+pad},${py} A${pad},${pad} 0 1,0 ${px-pad},${py}`;
  }
  const hull=d3.polygonHull(pts.map(p=>[p[0],p[1]]));
  if(!hull||hull.length<3){
    const cx=d3.mean(pts,p=>p[0]),cy=d3.mean(pts,p=>p[1]);
    const rx=Math.max(pad*1.5,d3.max(pts,p=>Math.abs(p[0]-cx))+pad);
    const ry=Math.max(pad,d3.max(pts,p=>Math.abs(p[1]-cy))+pad);
    return `M${cx-rx},${cy} A${rx},${ry} 0 1,0 ${cx+rx},${cy} A${rx},${ry} 0 1,0 ${cx-rx},${cy}`;
  }
  const [hcx,hcy]=d3.polygonCentroid(hull);
  const exp=hull.map(([px,py])=>{
    const dx=px-hcx, dy=py-hcy, dist=Math.hypot(dx,dy)||1;
    return [(px+dx/dist*pad), (py+dy/dist*pad)];
  });
  // Catmull-Rom → cubic bezier (closed smooth curve)
  const n=exp.length, t=0.35;
  let path=`M${exp[0][0].toFixed(1)},${exp[0][1].toFixed(1)}`;
  for(let i=0;i<n;i++){
    const p0=exp[(i-1+n)%n], p1=exp[i], p2=exp[(i+1)%n], p3=exp[(i+2)%n];
    const cp1x=(p1[0]+(p2[0]-p0[0])*t).toFixed(1);
    const cp1y=(p1[1]+(p2[1]-p0[1])*t).toFixed(1);
    const cp2x=(p2[0]-(p3[0]-p1[0])*t).toFixed(1);
    const cp2y=(p2[1]-(p3[1]-p1[1])*t).toFixed(1);
    path+=` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return path+' Z';
}

// ── D3 초기화 ─────────────────────────────────────────
const svg = d3.select('#graph');
const defs = svg.append('defs');

const glow=defs.append('filter').attr('id','glow').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
glow.append('feGaussianBlur').attr('stdDeviation','5').attr('result','coloredBlur');
const fm=glow.append('feMerge');
fm.append('feMergeNode').attr('in','coloredBlur');
fm.append('feMergeNode').attr('in','SourceGraphic');

// 버블 헤일로용 소프트 블러 필터 (feGaussianBlur, 넓게 퍼지는 glow)
// 솔리드 마인드맵 노드용 그림자 필터
const dropShadow = defs.append('filter').attr('id', 'solid-shadow')
  .attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
dropShadow.append('feGaussianBlur').attr('in', 'SourceAlpha').attr('stdDeviation', '3').attr('result', 'blur');
dropShadow.append('feOffset').attr('dx', '0').attr('dy', '4').attr('result', 'offsetBlur');
dropShadow.append('feFlood').attr('flood-color', 'rgba(0,0,0,0.15)').attr('result', 'shadowColor');
dropShadow.append('feComposite').attr('in', 'shadowColor').attr('in2', 'offsetBlur').attr('operator', 'in').attr('result', 'shadow');
const fb = dropShadow.append('feMerge');
fb.append('feMergeNode').attr('in', 'shadow');
fb.append('feMergeNode').attr('in', 'SourceGraphic');

function lighten(hex,a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,Math.round(r+(255-r)*a))},${Math.min(255,Math.round(g+(255-g)*a))},${Math.min(255,Math.round(b+(255-b)*a))})`;
}
function makeGradient(id, color, opacity=1) {
  const gr=defs.append('radialGradient').attr('id',id).attr('cx','35%').attr('cy','35%').attr('r','65%');
  gr.append('stop').attr('offset','0%').attr('stop-color',lighten(color,0.40)).attr('stop-opacity',opacity);
  gr.append('stop').attr('offset','100%').attr('stop-color',color).attr('stop-opacity',opacity);
}
// 루트 노드 그라디언트
makeGradient('grad-root', ROOT_COLOR, 1);
// 카테고리별 halo 색상 그라디언트 (legacy - 사용 안 하지만 안전하게 유지)
CLUSTER_COLORS.forEach((c,i) => makeGradient(`grad-hub-${i}`, c, 1));
// 기타 1차
makeGradient('grad-nonhub', NON_HUB_COLOR, 0.88);
// 3차 연관
makeGradient('grad-d3', D3_COLOR, 0.80);
// 레거시 (링크등 일부 호환)
DEPTH_COLORS.forEach((c,i)=>makeGradient(`grad-${i}`,c,DEPTH_OPACITY[i]));

const zoomG=svg.append('g').attr('id','zoom-layer');
const zoom=d3.zoom().scaleExtent([0.1,5]).on('zoom',e=>zoomG.attr('transform',e.transform));
svg.call(zoom).on('dblclick.zoom',null);

const halosG=zoomG.append('g').attr('id','halos');
const linksG=zoomG.append('g').attr('id','links');
const nodesG=zoomG.append('g').attr('id','nodes');

function boundingForce() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||800, H=el.clientHeight||600, pad=100;
  nodes.forEach(n=>{
    if(n.depth===0) return;
    if(n.x<pad)    n.vx+=(pad-n.x)*0.4;
    if(n.x>W-pad)  n.vx+=(W-pad-n.x)*0.4;
    if(n.y<pad)    n.vy+=(pad-n.y)*0.4;
    if(n.y>H-pad)  n.vy+=(H-pad-n.y)*0.4;
  });
}

const simulation=d3.forceSimulation()
  .force('link',d3.forceLink().id(d=>d.id).distance(32).strength(0.45))
  .force('charge',d3.forceManyBody().strength(d=>d.depth===0?-420:d.isHub?-240:d.depth===3?-65:-120).distanceMax(340))
  .force('center',d3.forceCenter(400,300))
  .force('collision',d3.forceCollide().radius(d=>nodeRadius(d)+8))
  .force('bounds',boundingForce)
  .alphaDecay(0.016)
  .velocityDecay(0.28);

let nodes=[],links=[];
const nodeIds=new Set();
let isLoading=false;

// ── 노드 색상 (역할별 플랫 — 글래스모피즘) ─────────────────
function nodeFillColor(d) {
  if (d.depth===0) return ROOT_COLOR;
  if (d.isHub)     return HUB_COLOR;
  if (d.depth===1) return NON_HUB_COLOR;
  if (d.depth===2) return D2_COLOR;
  if (d.depth===3) return D3_COLOR;
  return NON_HUB_COLOR;
}
function nodeGlowColor(d) { return nodeFillColor(d); }
function nodeTextColor(d) {
  if (d.depth===0) return '#FFFFFF';
  if (d.depth===3) return '#334155';
  return '#111827';
}

// ── 그래프 렌더 ───────────────────────────────────────
function updateGraph() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||800, H=el.clientHeight||600;

  // 반경: 허브 링 / 2차 링 / 3차 링
  const hubR  = Math.min(W,H)*0.19;
  const d2R   = Math.min(W,H)*0.36;
  const d3R   = Math.min(W,H)*0.48;

  // 허브 각도: currentClusters.length 기준 pre-allocate
  // hubIdx(0~N-1)로 직접 접근하므로 배열 크기 = 실제 허브 수
  const nHubs = currentClusters.length || MAX_HUB;
  const hubAngles = Array.from({length:nHubs}, (_,i)=>(i/nHubs)*2*Math.PI - Math.PI/2);

  // 허브별 depth-2, depth-3 멤버 인덱스 → 부채꼴 오프셋
  const memberMap={};
  nodes.forEach(n=>{
    if(n.depth<2||n.hubIdx==null) return;
    const key=`${n.hubIdx}-${n.depth}`;
    if(!memberMap[key]) memberMap[key]=[];
    memberMap[key].push(n.id);
  });
  function angleOffset(n) {
    const key=`${n.hubIdx}-${n.depth}`;
    const ms=memberMap[key]||[];
    const idx=ms.indexOf(n.id), cnt=ms.length;
    if(cnt<=1) return 0;
    const spread=n.depth===2?(Math.PI/180*32):(Math.PI/180*18);
    return (idx/(cnt-1)-0.5)*2*spread;
  }

  // 1차 서브 연관(허브가 아닌) 노드들을 위한 내부 링 계산
  const nonHubs = nodes.filter(n => n.depth === 1 && !n.isHub);
  const innerAngles = {};
  nonHubs.forEach((n, i) => { innerAngles[n.id] = (i / nonHubs.length) * 2 * Math.PI; });

  // 목표 좌표
  function tx(n) {
    if(n.depth===0) return W/2;
    if(n.isHub) return W/2+Math.cos(hubAngles[n.hubIdx])*hubR*1.1; // 허브 반경 약간 확대
    if(n.depth===1) return W/2 + Math.cos(innerAngles[n.id]) * (hubR * 0.55); // 명확한 내부 링
    if(n.hubIdx==null) return W/2;
    const ang=hubAngles[n.hubIdx]+angleOffset(n);
    return W/2+Math.cos(ang)*(n.depth===2?d2R*1.05:d3R*0.95);
  }
  function ty(n) {
    if(n.depth===0) return H/2;
    if(n.isHub) return H/2+Math.sin(hubAngles[n.hubIdx])*hubR*1.1;
    if(n.depth===1) return H/2 + Math.sin(innerAngles[n.id]) * (hubR * 0.55);
    if(n.hubIdx==null) return H/2;
    const ang=hubAngles[n.hubIdx]+angleOffset(n);
    return H/2+Math.sin(ang)*(n.depth===2?d2R*1.05:d3R*0.95);
  }
  function forceStr(n) {
    if(n.depth===0) return 0;
    if(n.isHub)     return 0.95;
    if(n.depth===1) return 0.85;   // 비허브 1차 노드의 위치를 강하게 고정하여 이탈 및 누락 방지
    if(n.depth===2) return 0.85;
    if(n.depth===3) return 0.78;
    return 0;
  }

  simulation
    .force('clusterX', d3.forceX(tx).strength(forceStr))
    .force('clusterY', d3.forceY(ty).strength(forceStr))
    .force('radial', null);

  // 링크 (강도 상위 MAX_LINKS_SHOW개)
  const shownLinks=[...links].sort((a,b)=>(b.strength||0)-(a.strength||0)).slice(0,MAX_LINKS_SHOW);
  const link=linksG.selectAll('path.link-path').data(shownLinks,d=>`${d.source?.id||d.source}→${d.target?.id||d.target}`);
  link.enter().append('path').attr('class','link-path').attr('fill','none').attr('stroke-linecap','round');
  link.exit().remove();

  const node=nodesG.selectAll('g.node-group').data(nodes,d=>d.id);
  const enter=node.enter().append('g').attr('class','node-group')
    .style('opacity',0).style('cursor','pointer')
    .call(d3.drag()
      .on('start',(e,d)=>{if(!e.active)simulation.alphaTarget(0.1).restart();d.fx=d.x;d.fy=d.y;tooltipEl.classList.remove('visible');})
      .on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y;
        if(e.sourceEvent){tooltipEl.style.left=(e.sourceEvent.clientX+14)+'px';tooltipEl.style.top=(e.sourceEvent.clientY-8)+'px';}})
      .on('end',(e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}))
    .on('mouseenter',onHover).on('mouseleave',onLeave).on('click',onClick);

  // 메인 원 — 솔리드 SaaS 스타일 (단색 + 선명한 쉐도우)
  enter.append('circle').attr('class','node-circle')
    .attr('r',d=>nodeRadius(d))
    .attr('fill',d=>nodeFillColor(d))
    .attr('fill-opacity', 1.0)
    .attr('stroke', d=>d.depth===0?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.6)')
    .attr('stroke-width', d=>d.depth===0?3:1)
    .attr('filter', 'url(#solid-shadow)');

  // 텍스트 — 클린 볼드, 테두리 없음
  enter.each(function(d) {
    const r=nodeRadius(d);
    const fs=d.depth===0?15:d.isHub?13:d.depth===1?11:d.depth===2?10:9;
    const isHubLabel = d.isHub ? `${d.hubIdx + 1}순위 핵심 연관` : null;
    const maxW=r*1.85;
    const cpl=Math.max(2,Math.floor(maxW/(fs*0.62)));
    const chars=[...d.label];
    const lines=[];
    for(let i=0;i<chars.length;i+=cpl) lines.push(chars.slice(i,i+cpl).join(''));
    
    const lh=fs+3;
    const totalLines = isHubLabel ? lines.length + 1 : lines.length;
    const startY=-(totalLines-1)*lh/2 + fs*0.35;
    const fillCol=nodeTextColor(d);
    
    const txt=d3.select(this).append('text').attr('class','node-label')
      .attr('text-anchor','middle').attr('fill',fillCol)
      .attr('stroke','none')
      .attr('font-size',`${fs}px`).attr('font-weight','700')
      .attr('font-family','var(--font)')
      .attr('letter-spacing','-0.02em')
      .attr('pointer-events','none');
      
    if (isHubLabel) {
      txt.append('tspan').attr('x',0).attr('dy',startY)
         .attr('font-size',`${fs*0.75}px`).attr('font-weight','800')
         .attr('fill', 'rgba(0,0,0,0.5)')
         .text(isHubLabel);
      lines.forEach((l,i)=>{
        txt.append('tspan').attr('x',0).attr('dy',lh).text(l);
      });
    } else {
      lines.forEach((l,i)=>{
        txt.append('tspan').attr('x',0).attr('dy',i===0?startY:lh).text(l);
      });
    }
  });

  enter.transition().duration(500).ease(d3.easeCubicOut).style('opacity',1);
  node.exit().remove();

  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.force('link').distance(d=>{
    const t=nodes.find(n=>n.id===(d.target?.id||d.target));
    if(!t) return 55;
    if(t.isHub) return 48;
    if(t.depth===1) return 32;
    if(t.depth===2) return 42;
    if(t.depth===3) return 36;
    return 44;
  });
  simulation.force('collision').radius(d=>nodeRadius(d)+(d.depth===0?26:d.isHub?20:d.depth===1?14:d.depth===2?13:10));
  simulation.force('center',d3.forceCenter(W/2,H/2));
  simulation.alpha(0.75).restart();

  linksG.selectAll('path.link-path')
    .attr('stroke',d=>linkColor(d))
    .attr('stroke-width',d=>linkWidth(d));

  let tickCount=0;
  simulation.on('tick',()=>{
    linksG.selectAll('path.link-path').attr('d',d=>{
      const sx=d.source.x,sy=d.source.y,tx=d.target.x,ty=d.target.y;
      const dx=tx-sx,dy=ty-sy,len=Math.sqrt(dx*dx+dy*dy)||1;
      const ox=-dy/len*len*0.14, oy=dx/len*len*0.14;
      const mx=(sx+tx)/2+ox, my=(sy+ty)/2+oy;
      return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
    });
    nodesG.selectAll('g.node-group').attr('transform',d=>`translate(${d.x},${d.y})`);
    if(tickCount++%4===0) renderHalos();
  });
}

// ── 허브 헐(halo) 렌더 — 라벨 제거, 선 강조 ─────────────────
function renderHalos() {
  halosG.selectAll('.ch').data(currentClusters,d=>d.id).join(
    enter=>enter.append('g').attr('class','ch').call(g=>{
      g.append('path').attr('class','ch-fill');
    })
  ).each(function(cluster){
    const hi=cluster.hubIdx;
    const cNodes=nodes.filter(n=>
      (n.isHub && n.hubIdx===hi) || (n.hubIdx===hi && n.depth>=2)
    ).filter(n=>n.x!=null&&!isNaN(n.x));
    if(cNodes.length<2) return;
    const pts=cNodes.map(n=>[n.x,n.y]);
    const pad=45; // 넓은 영역 확보
    d3.select(this).select('.ch-fill')
      .attr('d',hullPath(pts,pad))
      .attr('fill',cluster.color).attr('fill-opacity',0.08)
      .attr('stroke',cluster.color).attr('stroke-width',2)
      .attr('stroke-opacity',0.4)
      .style('filter', 'drop-shadow(0 4px 12px rgba(0,0,0,0.03))');
  });
}

// ── 호버 / 클릭 ───────────────────────────────────────
const tooltipEl=document.getElementById('tooltip');
const infoPanelEl=document.getElementById('info-panel');

function onHover(e,d) {
  const r=nodeRadius(d);
  d3.select(this).select('.node-circle').transition().duration(250).ease(d3.easeSpring||d3.easeCubicOut).attr('r',r*1.12);
  tooltipEl.textContent=d.label;
  tooltipEl.style.left=(e.clientX+14)+'px';tooltipEl.style.top=(e.clientY-8)+'px';
  tooltipEl.classList.add('visible');
  // 연결된 노드/링크만 강조, 나머지 흐리게
  const connectedIds=new Set([d.id]);
  links.forEach(lk=>{
    const s=lk.source?.id||lk.source, t=lk.target?.id||lk.target;
    if(s===d.id) connectedIds.add(t);
    if(t===d.id) connectedIds.add(s);
  });
  nodesG.selectAll('g.node-group').transition().duration(150)
    .style('opacity',n=>connectedIds.has(n.id)?1:0.18);
  linksG.selectAll('path.link-path').transition().duration(150)
    .style('opacity',lk=>{
      const s=lk.source?.id||lk.source, t=lk.target?.id||lk.target;
      return (s===d.id||t===d.id)?1:0.06;
    });
}
function onLeave(e,d) {
  const r=nodeRadius(d);
  d3.select(this).select('.node-circle').transition().duration(250).ease(d3.easeCubicOut).attr('r',r);
  tooltipEl.classList.remove('visible');
  nodesG.selectAll('g.node-group').transition().duration(200).style('opacity',1);
  linksG.selectAll('path.link-path').transition().duration(200).style('opacity',1);
}
function onClick(e,d) {
  e.stopPropagation();
  if(isLoading) return;
  const maxV = Math.max(d.pcVol, d.mobileVol, 1);
  const pcPct = d.pcVol ? Math.max(2, Math.round(d.pcVol/maxV*100)) : 0;
  const moPct = d.mobileVol ? Math.max(2, Math.round(d.mobileVol/maxV*100)) : 0;
  infoPanelEl.innerHTML=`
    <div class="info-card-header">
      <span class="info-kw">${d.label}</span>
      <span class="info-depth">${d.depth===0?'검색어':d.isHub?'TOP5 핵심':d.depth+'차 연관어'}</span>
    </div>
    ${d.totalVol ? `
    <div class="card-bars">
      <div class="card-bar-row">
        <span class="card-bar-label pc">PC</span>
        <div class="card-bar-track"><div class="card-bar-fill pc" style="width:${pcPct}%"></div></div>
        <span class="card-bar-val">${(d.pcVol||0).toLocaleString()}</span>
      </div>
      <div class="card-bar-row">
        <span class="card-bar-label mo">MO</span>
        <div class="card-bar-track"><div class="card-bar-fill mo" style="width:${moPct}%"></div></div>
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
    </div>` : '<div style="font-size:12px;color:#9ca3af;padding:8px 0">검색량 데이터 없음</div>'}
    <div class="hint" onclick="window.reSearch('${d.label.replace(/'/g,"\\'")}')">이 키워드로 새 검색 →</div>`;
  infoPanelEl.classList.add('visible');
}
svg.on('click',()=>infoPanelEl.classList.remove('visible'));
document.querySelector('.mindmap-content-wrap').addEventListener('mouseleave',()=>infoPanelEl.classList.remove('visible'));
window.reSearch=kw=>{
  document.getElementById('searchInput').value=kw;
  const hdrIn=document.getElementById('headerInput');
  if(hdrIn) hdrIn.value=kw;
  startSearch(kw);
};

// ── 데이터 엑셀 다운로드 ─────────────────────────────────
function downloadExcel() {
  if(!nodes.length){showToast('데이터가 없습니다');return;}
  const kw=currentKeyword||'mindmap';
  const headers=['키워드','깊이','PC 검색량','MO 검색량','전체 검색량','PC 클릭율','MO 클릭율','경쟁도'];
  const rows=nodes
    .sort((a,b)=>a.depth-b.depth||b.totalVol-a.totalVol)
    .map(n=>[
      n.label,
      n.depth===0?'검색어':`${n.depth}차 연관`,
      n.pcVol||0, n.mobileVol||0, n.totalVol||0,
      n.pcCtr?`${n.pcCtr}%`:'0%',
      n.mobileCtr?`${n.mobileCtr}%`:'0%',
      n.compIdx||'-',
    ]);
  const tsv='\ufeff'+[headers,...rows].map(r=>r.join('\t')).join('\n');
  const blob=new Blob([tsv],{type:'text/tab-separated-values;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`naver_mindmap_${kw}_${new Date().toISOString().slice(0,10)}.xls`;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);URL.revokeObjectURL(url);
  showToast('다운로드 완료!');
}

// ── 스마트 수집 (허브 기반, 3 API 배치) ──────────────────
async function collectAll(rootKeyword, rootId, prefetchedRoot) {
  const barEl=document.getElementById('progress-bar');
  const progEl=document.getElementById('loading-progress');
  function prog(pct,text){if(barEl)barEl.style.width=pct+'%';if(progEl)progEl.textContent=text;}

  prog(10,'키워드 스코어링...');

  // 점수 계산 후 정렬
  const scored=prefetchedRoot
    .map((item,idx)=>({...item,_score:relevanceScore(item,idx)}))
    .sort((a,b)=>b._score-a._score);

  // TOP5 → 허브 / 나머지 MAX_D1개 → 기타 1차
  const hubs    = scored.slice(0, MAX_HUB);
  const nonHubs = scored.slice(MAX_HUB, MAX_HUB + MAX_D1);

  // 실제 추가된 허브만 클러스터로 생성 (skip된 허브 제외)
  // hubIdx를 sequential로 배정해야 hubAngles[hubIdx] 인덱스 매핑이 정확함
  const addedHubs = [];
  hubs.forEach((item)=>{
    const id=item.keyword.toLowerCase().trim();
    if(!id||nodeIds.has(id)) return;
    addedHubs.push(item);
  });
  currentClusters = addedHubs.map((item,i)=>({
    id:`hub-${i}`, hubIdx:i,
    label:item.keyword||'',
    color:CLUSTER_COLORS[i%CLUSTER_COLORS.length],
    items:[item],
  }));
  prog(20,`TOP${addedHubs.length} 허브 선정 완료`);

  // 허브 노드 추가 (sequential hubIdx: 0,1,2,3,4 순서 보장)
  addedHubs.forEach((item,i)=>{
    const id=item.keyword.toLowerCase().trim();
    nodeIds.add(id);
    nodes.push({id,label:item.keyword,depth:1,isHub:true,hubIdx:i,
      totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
      pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
      pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,compIdx:item.compIdx||'',
      _score:item._score});
    links.push({source:rootId,target:id,strength:item._score});
  });

  // 기타 1차 노드 추가 (depth-1, isHub=false)
  nonHubs.forEach(item=>{
    const id=item.keyword.toLowerCase().trim();
    if(!id||nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({id,label:item.keyword,depth:1,isHub:false,hubIdx:null,
      totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
      pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
      pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,compIdx:item.compIdx||'',
      _score:item._score});
    links.push({source:rootId,target:id,strength:item._score*0.35});
  });

  prog(30,`depth-2 수집 중 (허브 ${addedHubs.length}개 병렬)...`);

  // Batch 2: 허브당 depth-2 병렬 수집
  const hubNodes=nodes.filter(n=>n.isHub);
  const d2Results=await Promise.allSettled(hubNodes.map(n=>fetchNaverKeywords(n.label)));

  const d3Parents=[];  // batch 3용 (허브당 최상위 depth-2 노드 1개)

  d2Results.forEach((r,i)=>{
    prog(30+((i+1)/hubNodes.length)*30,`depth-2 (${i+1}/${hubNodes.length}) 완료`);
    if(r.status!=='fulfilled') return;
    const hubNode=hubNodes[i];
    let added=0;
    r.value.slice(0,MAX_D2_PER*3).forEach((item,idx)=>{
      if(added>=MAX_D2_PER) return;
      const id=item.keyword.toLowerCase().trim();
      if(!id||nodeIds.has(id)) return;
      nodeIds.add(id);
      added++;
      const sc=relevanceScore(item,idx)*0.5;
      const d2n={id,label:item.keyword,depth:2,isHub:false,hubIdx:hubNode.hubIdx,
        totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
        pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
        pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,compIdx:item.compIdx||'',
        _score:sc};
      nodes.push(d2n);
      links.push({source:hubNode.id,target:id,strength:sc});
      if(added===1) d3Parents.push(d2n);  // 허브당 top-1 depth-2 → batch3 대상
    });
  });

  prog(60,`depth-3 수집 중 (${d3Parents.length}개 병렬)...`);

  // Batch 3: 허브당 최상위 depth-2에서 depth-3 수집
  if(d3Parents.length>0) {
    const d3Results=await Promise.allSettled(d3Parents.map(n=>fetchNaverKeywords(n.label)));
    d3Results.forEach((r,i)=>{
      prog(60+((i+1)/d3Parents.length)*35,`depth-3 (${i+1}/${d3Parents.length}) 완료`);
      if(r.status!=='fulfilled') return;
      const parentNode=d3Parents[i];
      let added=0;
      r.value.slice(0,MAX_D3_PER*3).forEach((item,idx)=>{
        if(added>=MAX_D3_PER) return;
        const id=item.keyword.toLowerCase().trim();
        if(!id||nodeIds.has(id)) return;
        nodeIds.add(id);
        added++;
        const sc=relevanceScore(item,idx)*0.25;
        nodes.push({id,label:item.keyword,depth:3,isHub:false,hubIdx:parentNode.hubIdx,
          totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
          pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
          pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,compIdx:item.compIdx||'',
          _score:sc});
        links.push({source:parentNode.id,target:id,strength:sc});
      });
    });
  }

  prog(100,`총 ${nodes.length}개 키워드 (허브 ${hubNodes.length}개)`);
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
  const hb=document.getElementById('headerBtn');
  if(hb) hb.disabled=active;
  if(!active) {
    document.getElementById('loading-progress').textContent='';
    const b=document.getElementById('progress-bar');
    if(b) b.style.width='0%';
  }
}

function updateLegend(keyword) {
  const items=[
    {label:keyword||'검색어', color:ROOT_COLOR},
    {label:'1차 핵심 연관', color:HUB_COLOR},
    {label:'1차 서브 연관', color:NON_HUB_COLOR},
    {label:'2차 연관', color:D2_COLOR},
    {label:'3차 연관', color:D3_COLOR},
  ];
  const wrap=document.getElementById('mm-legend');
  wrap.innerHTML=items.map(item=>
    `<div class="mm-legend-item"><div class="mm-dot" style="background:${item.color};opacity:0.9"></div>${item.label}</div>`
  ).join('');
}

// ── 히어로 → 결과 전환 ────────────────────────────────
function showResults() {
  const hero=document.getElementById('hero-section');
  const header=document.getElementById('site-header');
  const results=document.getElementById('results-wrap');
  if(hero) hero.classList.add('hidden');
  if(header) header.classList.remove('hidden');
  if(results) results.classList.remove('hidden');
}

// ── 검색 시작 ─────────────────────────────────────────
async function startSearch(keyword) {
  if(!keyword||isLoading) return;
  keyword=keyword.trim();
  currentKeyword=keyword;

  // 상태 초기화
  nodes=[];links=[];nodeIds.clear();currentClusters=[];
  halosG.selectAll('*').remove();linksG.selectAll('*').remove();nodesG.selectAll('*').remove();
  infoPanelEl.classList.remove('visible');
  emptyState.classList.add('hidden');
  document.getElementById('kw-cards').innerHTML='';
  document.getElementById('trend-chart').innerHTML='';

  // 헤더 인풋 동기화
  const hdrIn=document.getElementById('headerInput');
  if(hdrIn) hdrIn.value=keyword;

  // 히어로에서 첫 검색이면 로딩은 히어로 위에 오버레이, 결과 노출은 완료 후
  const isFirst=document.getElementById('results-wrap').classList.contains('hidden');
  setLoading(true,`"${keyword}" 수집 중...`);
  updateLegend(keyword);

  const rootId=keyword.toLowerCase();
  nodeIds.add(rootId);
  nodes.push({id:rootId,label:keyword,depth:0,
    totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0,
    fx:400,fy:300}); // 임시 좌표, showResults 후 실측으로 교체

  try {
    const [firstLevel, trendResult] = await Promise.all([
      fetchNaverKeywords(keyword),
      fetchTrend(keyword),
    ]);

    // root 노드 stats 업데이트
    const normKw=keyword.toLowerCase().trim();
    const rootStats=firstLevel.find(d=>d.keyword.toLowerCase().trim()===normKw)||firstLevel[0]||{};
    const rn=nodes.find(n=>n.id===rootId);
    if(rn) Object.assign(rn,{totalVol:rootStats.totalVol||0,pcVol:rootStats.pcVol||0,mobileVol:rootStats.mobileVol||0});

    // 전수 BFS 수집
    await collectAll(keyword, rootId, firstLevel);

    // 데이터 준비 완료 → 결과 화면 전환
    setLoading(false);
    if(isFirst) showResults();

    // 줌 리셋 + 실제 SVG 크기로 루트 좌표 업데이트
    svg.call(zoom.transform, d3.zoomIdentity);
    const graphEl=document.getElementById('graph');
    const W=graphEl.clientWidth||800, H=graphEl.clientHeight||600;
    if(rn){rn.fx=W/2;rn.fy=H/2;}

    const pcAbs=rootStats.pcVol||0, moAbs=rootStats.mobileVol||0;
    renderStats(keyword, firstLevel);
    renderTrendChart(trendResult?.trend||null, pcAbs, moAbs);
    renderGenderAge(trendResult);

    if(nodes.length>1) {
      updateGraph();
      showToast(`총 ${nodes.length}개 키워드 로드 완료`);
    } else {
      emptyState.classList.remove('hidden');
      showToast('연관 검색어를 찾지 못했습니다. 다른 키워드를 시도해보세요.');
    }
  } catch(e) {
    console.error(e);
    showToast('오류가 발생했습니다. 다시 시도해주세요.');
    setLoading(false);
    if(isFirst) showResults();
  }
}

// ── 이벤트 ────────────────────────────────────────────
// 히어로 검색
document.getElementById('searchBtn').addEventListener('click',()=>{
  const kw=document.getElementById('searchInput').value.trim();
  if(kw) startSearch(kw);
});
document.getElementById('searchInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const kw=e.target.value.trim();if(kw)startSearch(kw);}
});
// 헤더 검색
document.getElementById('headerBtn').addEventListener('click',()=>{
  const kw=document.getElementById('headerInput').value.trim();
  if(kw){document.getElementById('searchInput').value=kw;startSearch(kw);}
});
document.getElementById('headerInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const kw=e.target.value.trim();if(kw){document.getElementById('searchInput').value=kw;startSearch(kw);}}
});
const copyTrendBtn=document.getElementById('copy-trend-btn');
if(copyTrendBtn) copyTrendBtn.addEventListener('click',copyTrendData);
const dlBtn=document.getElementById('download-btn');
if(dlBtn) dlBtn.addEventListener('click',downloadExcel);
window.addEventListener('resize',()=>{
  const el=document.getElementById('graph');
  simulation.force('center',d3.forceCenter(el.clientWidth/2,el.clientHeight/2)).alpha(0.1).restart();
});
svg.call(zoom.transform,d3.zoomIdentity);
renderGenderAge(null);
