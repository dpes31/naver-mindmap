const ROOT_COLOR     = '#4F46E5';   // Apple System Indigo
// 카테고리 halo 배경 색
const CLUSTER_COLORS = ['#6366F1','#10B981','#F97316','#06B6D4','#EC4899']; // Indigo, Emerald, Orange, Cyan, Pink
// 노드 fill 색 (역할별)
const HUB_COLOR      = '#10B981';   // 1차 핵심 연관 (통일된 초록색)
const NON_HUB_COLOR  = '#D1FAE5';   // 1차 서브 연관 (흐릿한 초록)
const D2_COLOR       = '#FBBF24';   // Amber (2차)
const D3_COLOR       = '#E2E8F0';   // Light Gray (3차 - 시각적 구분 명확화)

// 레전드용
const DEPTH_COLORS   = [ROOT_COLOR, HUB_COLOR, NON_HUB_COLOR, D2_COLOR, D3_COLOR];
const DEPTH_OPACITY  = [1, 1, 1, 1, 1];

const MAX_HUB        = 4; // 5 -> 4개 집단으로 회장님 확정
const MAX_D1         = 12; 
const MAX_D2_PER     = 10; // 8 -> 10으로 상향 (공간 충전용)
const MAX_D3_PER     = 8;  // 5 -> 8로 상향 (공간 충전용)
const MAX_LINKS_SHOW = 120; // 60 -> 120 (연결선 가독성 범위 확대)
const MAX_DEPTH      = 3;
let currentClusters  = [];
let currentKeyword   = '';

// ── DOM 요소 선언 (누락된 변수 정의) ──────────────────
const infoPanelEl = document.getElementById('info-panel');
const emptyState  = document.getElementById('empty-state');
const tooltipEl   = document.getElementById('tooltip');
// ──────────────────────────────────────────────────

function updateProgress(pct, msg) {
  const pbar = document.getElementById('progress-bar');
  const pt = document.getElementById('loading-progress');
  if (pbar) pbar.style.width = `${pct}%`;
  if (pt) pt.innerText = msg ? `${msg} (${pct}%)` : `${pct}%`;
}

function setLoading(v, msg) {
  isLoading = !!v;
  const modal = document.getElementById('loading');
  const searchBtn = document.getElementById('searchBtn');
  const headerBtn = document.getElementById('headerBtn');
  
  if (searchBtn) searchBtn.disabled = v;
  if (headerBtn) headerBtn.disabled = v;

  if (v) {
    if (modal) modal.classList.add('active');
    updateProgress(0, msg);
  } else {
    // 성공 알림 등을 위해 약간 대기 후 닫기
    setTimeout(() => {
      if (modal) modal.classList.remove('active');
    }, 400);
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if(!el) return;
  el.innerText = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}





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
      // AbortSignal.timeout 호환성 문제 해결을 위해 전형적인 fetch 구조 사용
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 9000);
      const r=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(u),{signal:controller.signal});
      clearTimeout(tid);
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
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    const r=await fetch('/api/keywords?keyword='+encodeURIComponent(keyword),{signal:controller.signal});
    clearTimeout(tid);
    if(r.ok){const d=await r.json();if(d.keywords?.length>=2)return d.keywords;}
  } catch(e){}
  try {const k=await fetchViaProxy(keyword);if(k.length>=2)return wrapStrings(k);} catch(e){}
  return wrapStrings(await fetchAutocomplete(keyword));
}

// ── DataLab 추이 API ─────────────────────────────────
async function fetchTrend(keyword) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 12000);
    const r=await fetch('/api/trend?keyword='+encodeURIComponent(keyword),{signal:controller.signal});
    clearTimeout(tid);
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
// 기준: 마지막 DataLab 데이터포인트 월 === Search Ads API가 집계한 월이어야 앵커링 유효
// 새 달 초(1~7일)에는 Search Ads가 이전 달 기준이 아닐 수 있으므로 앵커링 사용 안 함
function scaleTrend(trend, pcAbs, moAbs, lastTrendMonth) {
  if (!trend?.length) return trend;
  const last = trend[trend.length - 1];

  // lastTrendMonth(DataLab 마지막 월)가 전달보다 이전이면 앵커 기준 불일치 → 스케일 스킵
  const now = new Date();
  const prevYM = (() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 0);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  })();
  const anchorMismatch = lastTrendMonth && lastTrendMonth < prevYM;
  const skipScale = !!anchorMismatch;

  const pcRef = last?.pc || 1, moRef = last?.mo || 1;
  return trend.map(d=>({
    period: d.period,
    pc: (!skipScale && pcAbs > 0) ? Math.round(d.pc / pcRef * pcAbs) : Math.round(d.pc),
    mo: (!skipScale && moAbs > 0) ? Math.round(d.mo / moRef * moAbs) : Math.round(d.mo),
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
function renderTrendChart(trendData, pcAbsNow, moAbsNow, lastTrendMonth) {
  const container = document.getElementById('trend-chart');
  const legendEl  = document.getElementById('trend-legend');
  container.innerHTML = '';
  if (legendEl) legendEl.innerHTML = '';

  if (!trendData || trendData.length === 0) {
    container.innerHTML = '<div class="trend-placeholder">DataLab API 데이터 없음<span style="font-size:11px;display:block;margin-top:4px">Vercel 환경변수: NAVER_DATALAB_CLIENT_ID / SECRET 확인</span></div>';
    return;
  }

  // Search Ads API 절대값 기준으로 스케일링 (마지막 월 = Search Ads API 정확값)
  const data = scaleTrend(trendData, pcAbsNow||0, moAbsNow||0, lastTrendMonth);
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

  const xAx=svg.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).tickFormat(d=>(d&&typeof d==='string'?d.slice(2):d)));
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
          <div class="gender-device-title">💻 PC</div>
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
          <div class="gender-device-title">📱 Mobile</div>
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
// base: 역할별 기본 크기 / range: 검색량에 따라 base ± range 범위로 가변
function nodeRadius(d) {
  if (d.depth === 0) return 90;
  // 검색량 기반 가변 크기: sqrt 스케일 (log보다 시각적 차이 뚜렷)
  const [minR, maxR] = d.isHub     ? [30, 65]   // 허브: 30~65px (2배 이상 차이 가능)
                     : d.depth===1 ? [14, 22]   // 1차 서브
                     : d.depth===2 ? [11, 26]   // 2차
                     :               [7,  14];  // 3차
  if (!d.totalVol || !nodes.length) return minR;
  // 허브는 4개 전체 비교, 나머지는 같은 클러스터 내 같은 depth끼리 비교
  const peers = d.isHub
    ? nodes.filter(n => n.isHub)
    : nodes.filter(n => n.depth === d.depth && n.hubIdx === d.hubIdx);
  const maxVol = Math.max(...peers.map(n => n.totalVol || 0), 1);
  if (maxVol === 0) return minR;
  const scale = Math.sqrt(d.totalVol / maxVol); // sqrt: log보다 차이 크게 반영
  return Math.round(minR + (maxR - minR) * scale);
}

function linkWidth(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t) return 1.5;
  if (t.isHub)     return 4.0; // 허브 연결선은 매우 굵고 확실하게
  if (t.depth===1) return 3.0;
  if (t.depth===2) return 2.2;
  if (t.depth===3) return 1.5;
  return 1.5;
}

function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
// ── 클러스터 헐(hull) 패스 — Catmull-Rom 스무스 곡선 알고리즘 적용 (찌그러짐 방지) ────
function smoothHull(pts, pad) {
  if(!pts||pts.length<3) {
    if(!pts.length) return '';
    const [px,py]=pts[0];
    return `M${px-pad},${py} A${pad},${pad} 0 1,0 ${px+pad},${py} A${pad},${pad} 0 1,0 ${px-pad},${py}`;
  }
  const hull=d3.polygonHull(pts);
  if(!hull) return '';
  // 폴리곤 중심점 계산
  const cx = d3.mean(hull, p=>p[0]);
  const cy = d3.mean(hull, p=>p[1]);
  // 중심에서 바깥쪽으로 pad만큼 팽창(Expand)시킨 포인트 배열 생성
  const expanded = hull.map(p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    return [p[0] + (dx/dist)*pad, p[1] + (dy/dist)*pad];
  });
  // CatmullRomClosed로 모든 각이 매끄러운 완벽한 유선형 아메바 형태 렌더링
  return d3.line().curve(d3.curveCatmullRomClosed)(expanded);
}
// 링크 색 및 투명도 상향 (선이 명확히 보이도록)
function linkColor(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t) return 'rgba(148,163,184,0.4)';
  // 허브 선은 카테고리 색상
  if (t.isHub)     return hexToRgba(CLUSTER_COLORS[(t.hubIdx||0)%CLUSTER_COLORS.length], 0.7);
  if (t.depth===1) return hexToRgba(NON_HUB_COLOR, 0.8);
  if (t.depth===2) return hexToRgba(D2_COLOR, 0.6);
  if (t.depth===3) return hexToRgba(D3_COLOR, 0.6);
  return 'rgba(148,163,184,0.4)';
}

// ── 연관성 점수 (API 순위 × 검색량) ─────────────────────
function relevanceScore(item, idx) {
  const posScore = 1 / (idx + 1);
  const volScore = Math.log1p(item.totalVol||0) / Math.log1p(500000);
  return +(posScore * 0.55 + volScore * 0.45).toFixed(4);
}

// currentClusters는 collectAll 내에서 직접 생성 (buildHubClusters 제거)

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
const halosG=zoomG.append('g').attr('id','halos');
const linksG=zoomG.append('g').attr('id','links');
const nodesG=zoomG.append('g').attr('id','nodes');

const zoom=d3.zoom()
  .scaleExtent([0.2, 3])
  .wheelDelta(e => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.001)) // 스크롤 줌 부드럽고 촘촘하게 튜닝
  .on('zoom',e=>{
    nodesG.attr('transform',e.transform);
    linksG.attr('transform',e.transform);
    halosG.attr('transform',e.transform);
  });
svg.call(zoom);

// 초기 마인드맵: 4분면 레이아웃 최적 배율 0.4
const _gEl = document.getElementById('graph');
const _gW = _gEl.clientWidth || 800;
const _gH = _gEl.clientHeight || 600;
svg.call(zoom.transform, d3.zoomIdentity.translate(_gW/2, _gH/2).scale(0.4).translate(-_gW/2, -_gH/2));

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
  // 1차 서브(depth-1 비허브) charge를 낮춰 허브 반발력에 밀리는 현상 방지
  .force('charge',d3.forceManyBody().strength(d=>
    d.depth===0 ? -120 :
    d.isHub ? -100 :
    (d.depth===1 && !d.isHub) ? -15 : // 서브 노드: 약한 charge → forceX/Y 우세
    d.depth===3 ? -25 : -45
  ).distanceMax(200))
  // forceCenter 제거: updateGraph에서 forceX/Y로 per-node 개별 목표 관리 (center 충돌 방지)
  .force('collision',d3.forceCollide().radius(d=>nodeRadius(d)+8))
  .force('bounds',boundingForce)
  .alphaDecay(0.02)
  .velocityDecay(0.4);

let nodes=[],links=[];
const nodeIds=new Set();
let isLoading=false;

// ── 노드 색상 (역할별 플랫) ─────────────────
function nodeFillColor(d) {
  if (d.depth===0) return ROOT_COLOR;
  if (d.isHub)     return HUB_COLOR; // 1차 핵심 연관 통일 (사용자 요청)
  if (d.depth===1) return NON_HUB_COLOR; 
  if (d.depth===2) return D2_COLOR;
  if (d.depth===3) return D3_COLOR;
  return NON_HUB_COLOR;
}
function nodeGlowColor(d) { return nodeFillColor(d); }
function nodeTextColor(d) {
  if (d.depth===0) return '#FFFFFF';
  if (d.isHub)     return '#FFFFFF';
  if (d.depth===1) return '#065F46'; // 흐린 배경 대비 진한 텍스트
  if (d.depth===3) return '#334155';
  return '#111827';
}

// ── 그래프 렌더 ───────────────────────────────────────
function updateGraph() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||1200, H=el.clientHeight||700;
  // 전체화면 모드에서 헤더 높이(약 50px)만큼 CY를 아래로 보정하여 상단 클러스터 가림 방지
  const headerEl = el.closest('.mindmap-content-wrap')?.querySelector('.mindmap-header');
  const headerH = headerEl ? headerEl.offsetHeight : 50;
  const CX = W/2, CY = (H + headerH) / 2;

  // 레이아웃 상수
  const R_SUB    = 100;  // 중앙 서브 노드 반경 (루트 주위 방사형 궤도)
  // 인접 허브 간 거리 = 1.414 * R_HUB. 겹침 없으려면 > halo_r * 2
  // halo_r=160 → 최소 R_HUB=226. 0.46 계수 + 최소 340px 보장
  const R_HUB    = Math.max(Math.min(W, H) * 0.46, 340);
  const R_ORBIT2 = 75;   // 집단 내 2차 반경
  const R_ORBIT3 = 135;  // 집단 내 3차 반경
  const HALO_R   = 160;  // halo 시각 원 반지름 (인접 거리 1.414*340=481 >> 160*2=320 ✅)
  const CLUSTER_BOUNDARY = 150; // 봉쇄 경계 (halo_r보다 10px 작게)

  const hubAngles = [Math.PI * 1.75, Math.PI * 1.25, Math.PI * 0.75, Math.PI * 0.25]; // NE, NW, SW, SE

  const memberMap = {};
  nodes.forEach(n => {
    if (n.hubIdx == null) return;
    const key = `${n.hubIdx}-${n.depth}`;
    if (!memberMap[key]) memberMap[key] = [];
    memberMap[key].push(n.id);
  });

  const nonHubs = nodes.filter(n => n.depth === 1 && !n.isHub);

  // ── 목표 좌표 계산 (2단계) ────────────────────────────────────────────────────
  // links에서 depth-3 → depth-2 부모 관계 추출 (시뮬레이션 실행 전후 모두 대응)
  const getId = v => (v && typeof v === 'object') ? v.id : v;
  const parentMap = {}; // depth-3 nodeId → depth-2 nodeId
  nodes.forEach(n => {
    if (n.depth !== 3) return;
    const pl = links.find(l => getId(l.target) === n.id);
    if (pl) parentMap[n.id] = getId(pl.source);
  });

  const d2AngleMap = {}; // depth-2 nodeId → 허브 기준 각도(rad) — depth-3 인접 배치에 사용

  // 1단계: depth-0, 1차 서브, 허브, depth-2 목표 좌표 계산
  nodes.forEach(n => {
    if (n.depth === 0) {
      n._tx = CX; n._ty = CY;
      // fx/fy를 강제 고정하지 않음 → 드래그 종료 후 forceX/Y(_tx/_ty)로 자연 복귀
      return;
    }
    if (n.depth === 1 && !n.isHub) {
      const idx = nonHubs.indexOf(n);
      const ang = (idx / (nonHubs.length || 1)) * 2 * Math.PI;
      n._tx = CX + Math.cos(ang) * R_SUB;
      n._ty = CY + Math.sin(ang) * R_SUB;
      return;
    }
    if (n.isHub && n.hubIdx != null) {
      const hIdx = n.hubIdx % 4;
      n._tx = CX + Math.cos(hubAngles[hIdx]) * R_HUB;
      n._ty = CY + Math.sin(hubAngles[hIdx]) * R_HUB;
      return;
    }
    if (n.depth === 2 && n.hubIdx != null) {
      const hIdx = n.hubIdx % 4;
      const hx = CX + Math.cos(hubAngles[hIdx]) * R_HUB;
      const hy = CY + Math.sin(hubAngles[hIdx]) * R_HUB;
      const d2List = memberMap[`${n.hubIdx}-2`] || [];
      const idx = d2List.indexOf(n.id);
      const cnt = d2List.length || 1;
      const ang = (idx / cnt) * 2 * Math.PI - Math.PI / 2;
      d2AngleMap[n.id] = ang; // depth-3 자식이 부모 각도로 fan 배치할 때 사용
      n._tx = hx + Math.cos(ang) * R_ORBIT2;
      n._ty = hy + Math.sin(ang) * R_ORBIT2;
    }
  });

  // 2단계: depth-3 노드를 부모 depth-2 방향 주변에 fan 배치 (쿠폰↔해외직구 인접)
  nodes.forEach(n => {
    if (n.depth !== 3 || n.hubIdx == null) return;
    const hIdx = n.hubIdx % 4;
    const hx = CX + Math.cos(hubAngles[hIdx]) * R_HUB;
    const hy = CY + Math.sin(hubAngles[hIdx]) * R_HUB;

    const parentId = parentMap[n.id];
    const parentAng = (parentId != null && d2AngleMap[parentId] != null)
      ? d2AngleMap[parentId] : null;

    if (parentAng != null) {
      // 같은 depth-2 부모를 공유하는 형제 depth-3 노드들
      const siblings = nodes.filter(s => s.depth === 3 && parentMap[s.id] === parentId);
      const sibIdx = siblings.indexOf(n);
      const sibCnt = siblings.length || 1;
      // 부모 방향 주변에 fan: 형제 1개면 정중앙, 여러 개면 ±(30°×형제수) 범위로 분산
      const spread = sibCnt === 1 ? 0 : Math.min(Math.PI * 0.6, (Math.PI / 5) * sibCnt);
      const offset = sibCnt === 1 ? 0 : (sibIdx / (sibCnt - 1) - 0.5) * spread;
      n._tx = hx + Math.cos(parentAng + offset) * R_ORBIT3;
      n._ty = hy + Math.sin(parentAng + offset) * R_ORBIT3;
    } else {
      // 부모 미확인 시 균등 분포 폴백
      const d3List = memberMap[`${n.hubIdx}-3`] || [];
      const idx = d3List.indexOf(n.id);
      const cnt = d3List.length || 1;
      const ang = (idx / cnt) * 2 * Math.PI - Math.PI / 2;
      n._tx = hx + Math.cos(ang) * R_ORBIT3;
      n._ty = hy + Math.sin(ang) * R_ORBIT3;
    }
  });

  // 초기 위치 설정: 처음 로드되었거나 목표에서 크게 벗어난 노드를 목표 위치로 순간이동
  // → forceCenter(400,300) 제거 후 랜덤 초기 위치로 인한 레이아웃 붕괴 방지
  nodes.forEach(n => {
    if (n._tx == null) return;
    const noPos = (n.x == null || isNaN(n.x));
    const farFromTarget = Math.abs((n.x||0) - n._tx) > 350 || Math.abs((n.y||0) - n._ty) > 350;
    if (noPos || farFromTarget) {
      n.x = n._tx + (Math.random() - 0.5) * 10;
      n.y = n._ty + (Math.random() - 0.5) * 10;
      n.vx = 0; n.vy = 0;
    }
  });

  // 집단 봉쇄 힘: depth 2/3 노드가 허브 원 밖을 벗어나지 못하게 함
  function clusterContain(alpha) {
    nodes.forEach(n => {
      if (n.depth < 2 || n.hubIdx == null) return;
      const hub = nodes.find(h => h.isHub && h.hubIdx === n.hubIdx);
      if (!hub || hub.x == null || isNaN(hub.x)) return;
      const dx = (n.x||0) - hub.x, dy = (n.y||0) - hub.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      if (dist > CLUSTER_BOUNDARY) {
        const over = (dist - CLUSTER_BOUNDARY) / dist;
        // alpha 무관하게 강한 고정값 사용 → 경계 탈출 원천 차단
        n.vx -= dx * over * 2.5;
        n.vy -= dy * over * 2.5;
      }
    });
  }

  // 물리 엔진: _tx/_ty를 목표로 당기는 힘 사용 (fx/fy가 null이어도 target 유지됨)
  simulation
    .alphaDecay(0.025)
    .velocityDecay(0.45)
    .force('center', null) // forceCenter 완전 제거 (초기화 잔류 방지)
    // 1차 서브 연관(depth-1 비허브): charge 낮췄으므로 forceX 강도도 1.0으로 고정하여 루트 궤도 사수
    .force('x', d3.forceX(d => d._tx || CX).strength(d => d.depth===0?1:d.isHub?0.95:(d.depth===1&&!d.isHub)?1.0:0.97))
    .force('y', d3.forceY(d => d._ty || CY).strength(d => d.depth===0?1:d.isHub?0.95:(d.depth===1&&!d.isHub)?1.0:0.97))
    .force('contain', clusterContain)
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + (d.depth===0?20:d.isHub?14:8)).strength(0.8))
    .alpha(0.6)
    .restart();

  // 링크 (강도 상위 MAX_LINKS_SHOW개)
  const shownLinks=[...links].sort((a,b)=>(b.strength||0)-(a.strength||0)).slice(0,MAX_LINKS_SHOW);
  const link=linksG.selectAll('path.link-path').data(shownLinks,d=>`${d.source?.id||d.source}→${d.target?.id||d.target}`);
  link.enter().append('path').attr('class','link-path').attr('fill','none').attr('stroke-linecap','round');
  link.exit().remove();

  const node=nodesG.selectAll('g.node-group').data(nodes,d=>d.id);
  const isMo = window.innerWidth <= 768;
  const enter=node.enter().append('g').attr('class','node-group')
    .style('opacity',0).style('cursor', window.innerWidth <= 768 ? 'default' : 'pointer');

  if (window.innerWidth > 768) {
    enter.call(d3.drag()
      .on('start',(e,d)=>{
        if(!e.active) simulation.alphaTarget(0.3).restart(); 
        d.fx=d.x; d.fy=d.y; 
        tooltipEl.classList.remove('visible');
      })
      .on('drag',(e,d)=>{
        const prevX = d.fx || d.x, prevY = d.fy || d.y;
        d.fx = e.x; d.fy = e.y;
        const dx = d.fx - prevX, dy = d.fy - prevY;
        
        // 허브 이동 시 자녀들 상대 좌표 유지하며 함께 이동
        if (d.isHub) {
          nodes.forEach(n => {
            if (n.hubIdx === d.hubIdx && n.id !== d.id) {
              if (n.fx != null) { n.fx += dx; n.fy += dy; }
              else { n.x += dx; n.y += dy; }
            }
          });
        }
        showInfoCard(d);
      })
      .on('end',(e,d)=>{
        if(!e.active) simulation.alphaTarget(0);
        // 루트 포함 모든 노드 fx/fy 해제 → forceX/Y(_tx/_ty)로 원위치 복귀
        d.fx = null; d.fy = null;
        if (d.isHub) {
          nodes.forEach(n => {
            if (n.hubIdx === d.hubIdx) { n.fx = null; n.fy = null; }
          });
        }
        simulation.alpha(0.4).restart();
      }))
      .on('mouseenter',onHover).on('mouseleave',onLeave).on('click',onClick);
  }

  // 메인 원 — 솔리드 SaaS 스타일 (단색 + 선명한 쉐도우)
  enter.append('circle').attr('class','node-circle')
    .attr('r',d=>nodeRadius(d))
    .attr('fill',d=>nodeFillColor(d))
    .attr('fill-opacity', 1.0)
    .attr('stroke', d=>d.depth===0?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.6)')
    .attr('stroke-width', d=>d.depth===0?3:1);

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
  simulation.force('link').strength(0.01);
  simulation.alpha(0.75).restart();

  linksG.selectAll('path.link-path')
    .attr('stroke',d=>linkColor(d))
    .attr('stroke-width',d=>linkWidth(d));

  let tickCount=0;
  simulation.on('tick',()=>{
    linksG.selectAll('path.link-path').attr('d',d=>{
      const sx=d.source.x, sy=d.source.y, tx=d.target.x, ty=d.target.y;
      if (isNaN(sx) || isNaN(sy) || isNaN(tx) || isNaN(ty)) return '';
      const dx=tx-sx, dy=ty-sy, len=Math.sqrt(dx*dx+dy*dy)||1;
      const ox=-dy/len*len*0.12, oy=dx/len*len*0.12;
      const mx=(sx+tx)/2+ox, my=(sy+ty)/2+oy;
      return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
    });
    nodesG.selectAll('g.node-group').attr('transform',d=>`translate(${d.x},${d.y})`);
    if(tickCount++%4===0) renderHalos();
  });
}

// ── 허브 헐(halo) 렌더 — 겹치지 않는 완전한 대형 원형 구조 ─────────────────
function renderHalos() {
  const hubs = nodes.filter(n => n.isHub && n.x != null && !isNaN(n.x));
  halosG.selectAll('.ch').data(hubs, d => d.id).join(
    enter => enter.append('g').attr('class', 'ch').call(g => {
      g.append('circle').attr('class', 'ch-fill');
    })
  ).each(function(hub) {
    const color = CLUSTER_COLORS[(hub.hubIdx||0) % CLUSTER_COLORS.length];
    d3.select(this).select('.ch-fill')
      .attr('cx', hub.x)
      .attr('cy', hub.y)
      .attr('r', 160) // HALO_R=160: 인접 거리 1.414*340=481 >> 160*2=320 ✅
      .attr('fill', color).attr('fill-opacity', 0.05)
      .attr('stroke', color).attr('stroke-width', 2)
      .attr('stroke-dasharray', '8,4')
      .attr('stroke-opacity', 0.8);
      // 검은색 바 유발하던 필터 속성 제거로 그래픽 노이즈 원천 차단
  });
}

// ── 인터랙션 (Hover, Click, Tooltip) ─────────────────────
function onHover(e, d) {
  if (window.innerWidth <= 768) return;
  d3.select(this).style('opacity', 0.8);
}

function onLeave(e, d) {
  if (window.innerWidth <= 768) return;
  d3.select(this).style('opacity', 1);
}

function onClick(e, d) {
  e.stopPropagation();
  if (window.innerWidth <= 768) return;
  showInfoCard(d);
}

function showInfoCard(d) {
  if (!infoPanelEl || window.innerWidth <= 768) return;
  
  const title = document.getElementById('info-title');
  const type  = document.getElementById('info-type');
  const pc    = document.getElementById('info-pc');
  const mo    = document.getElementById('info-mo');
  const tot   = document.getElementById('info-tot');
  const pcC  = document.getElementById('info-pc-clicks');
  const moC  = document.getElementById('info-mo-clicks');
  const ctr  = document.getElementById('info-ctr');
  
  if(title) title.innerText = d.label;
  if(type) type.innerText = d.depth === 0 ? '조사 키워드' : d.isHub ? '1차 핵심 연관' : d.depth + '차 연관 키워드';
  if(pc) pc.innerText = d.pcVol?.toLocaleString() || '0';
  if(mo) mo.innerText = d.mobileVol?.toLocaleString() || '0';
  if(tot) tot.innerText = d.totalVol?.toLocaleString() || '0';
  if(pcC) pcC.innerText = d.pcClicks?.toLocaleString() || '0';
  if(moC) moC.innerText = d.mobileClicks?.toLocaleString() || '0';
  if(ctr) {
    const avg = ((d.pcCtr || 0) + (d.mobileCtr || 0)) / 2;
    ctr.innerText = avg.toFixed(2) + '%';
  }
  
  infoPanelEl.classList.add('visible');
}

svg.on('click', () => {
  if(infoPanelEl) infoPanelEl.classList.remove('visible');
});

async function collectAll(rootKeyword, rootId, firstLevel) {
  updateProgress(15, '핵심 연관어 분석 중...');
  
  // ── 데이터 수집 (계층별 균등 쿼터제) ─────────────────────
  // 1. 중복 제거 및 검색어 자신 제외
  const normRoot = rootId.toLowerCase().trim();
  const uniqueRelated = [];
  const seenKws = new Set([normRoot]);
  
  firstLevel.forEach(item => {
    const k = item.keyword.toLowerCase().trim();
    if (!seenKws.has(k)) {
      seenKws.add(k);
      uniqueRelated.push(item);
    }
  });

  // 2. 계층 1 (Hubs & Sub-D1)
  const hubs = uniqueRelated.slice(0, MAX_HUB);
  currentClusters = hubs; 
  hubs.forEach((h, i) => {
    const id = h.keyword.toLowerCase().trim();
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push({ ...h, id, label: h.keyword, depth: 1, isHub: true, hubIdx: i });
      links.push({ source: rootId, target: id, strength: h.totalVol || 1 });
    }
  });

  const nonHubs = uniqueRelated.slice(MAX_HUB, MAX_HUB + 6); // 1차 서브 소수 정예
  nonHubs.forEach(h => {
    const id = h.keyword.toLowerCase().trim();
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push({ ...h, id, label: h.keyword, depth: 1, isHub: false });
      links.push({ source: rootId, target: id, strength: h.totalVol || 1 });
    }
  });

  // 3. 계층 2 (집단별 균등 배분 - 2차 연관어)
  updateProgress(40, '구역별 핵심 데이터 수집 중...');
  const d3Candidates = [];
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const arr = await fetchNaverKeywords(hub.keyword);
    // 각 집단당 최대 6개까지만 2차 연관어 배정하여 3차 연관어용 공간 확보
    const d2List = arr.filter(x => !nodeIds.has(x.keyword.toLowerCase()) && x.keyword.toLowerCase() !== rootId).slice(0, 6);
    
    d2List.forEach(k2 => {
      if (nodes.length >= 68) return; // 전체 70개 리미트
      const id2 = k2.keyword.toLowerCase();
      nodeIds.add(id2);
      nodes.push({ ...k2, id: id2, label: k2.keyword, depth: 2, isHub: false, hubIdx: i });
      links.push({ source: hub.keyword.toLowerCase(), target: id2, strength: k2.totalVol || 1 });
      d3Candidates.push({ keyword: k2.keyword, id: id2, hubIdx: i });
    });
    updateProgress(40 + (i+1)*10, `${i+1}번 구역 분석 완료...`);
  }

  // 4. 계층 3 (집단별 균등 배분 - 3차 연관어)
  // 회장님 요청: 3차 키워드가 영역을 꽉 채우도록 수집
  updateProgress(80, '세부 3차 연관어 정밀 확장 중...');
  let d3Count = 0;
  for (let cand of d3Candidates) {
    if (nodes.length >= 70) break;
    const arr = await fetchNaverKeywords(cand.keyword);
    const d3Item = arr.find(x => !nodeIds.has(x.keyword.toLowerCase()) && x.keyword.toLowerCase() !== rootId);
    
    if (d3Item) {
      const id3 = d3Item.keyword.toLowerCase();
      nodeIds.add(id3);
      nodes.push({ ...d3Item, id: id3, label: d3Item.keyword, depth: 3, isHub: false, hubIdx: cand.hubIdx });
      links.push({ source: cand.id, target: id3, strength: d3Item.totalVol || 1 });
      d3Count++;
    }
    if (d3Count % 4 === 0) updateProgress(80 + Math.min(15, d3Count), '웅장한 마인드맵 구성 중...');
  }

  updateProgress(100, '데이터 분석 완료');
}

function updateLegend(keyword) {
  const items=[
    {label:keyword||'검색어', color:ROOT_COLOR},
    {label:'1차 핵심 연관', color:'#10B981'}, // 예시 컬러
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
  
  if(infoPanelEl) infoPanelEl.classList.remove('visible');
  if(emptyState) emptyState.classList.add('hidden');
  
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
  const graphEl = document.getElementById('graph');
  const initCX = (graphEl?.clientWidth || 1200) / 2;
  const initCY = (graphEl?.clientHeight || 700) / 2;
  nodes.push({id:rootId,label:keyword,depth:0,
    totalVol:0,pcVol:0,mobileVol:0,pcClicks:0,mobileClicks:0,pcCtr:0,mobileCtr:0,
    fx: initCX, fy: initCY});

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
    console.log('Step 2: Collection Complete, Nodes:', nodes.length);

    // 데이터 준비 완료 → 결과 화면 전환
    if(isFirst) showResults();
    console.log('Step 3: UI Transitioned');

    // 줌 리셋 + 실제 SVG 크기로 루트 좌표 업데이트
    svg.call(zoom.transform, d3.zoomIdentity);
    if(rn){ const ge=document.getElementById('graph'); rn.fx=(ge?.clientWidth||1200)/2; rn.fy=(ge?.clientHeight||700)/2; }

    const pcAbs=rootStats.pcVol||0, moAbs=rootStats.mobileVol||0;
    renderStats(keyword, firstLevel);
    renderTrendChart(trendResult?.trend||null, pcAbs, moAbs, trendResult?.lastTrendMonth||null);
    renderGenderAge(trendResult);

    if(nodes.length>1) {
      updateGraph();
      showToast(`총 ${nodes.length}개 키워드 로드 완료`);
    } else {
      emptyState.classList.remove('hidden');
      showToast('연관 검색어를 찾지 못했습니다. 다른 키워드를 시도해보세요.');
    }
  } catch(e) {
    console.error('SEARCH ERROR:', e);
    showToast('오류가 발생했습니다: ' + e.message);
    if(isFirst) showResults();
  } finally {
    setLoading(false);
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
const dlBtn=document.getElementById('download-btn');
const copyTrendBtn=document.getElementById('copy-trend-btn');

function downloadExcel() {
  showToast('준비 중인 기능입니다');
}

if(copyTrendBtn) copyTrendBtn.addEventListener('click',copyTrendData);
if(dlBtn) dlBtn.addEventListener('click',downloadExcel);

window.addEventListener('resize',()=>{
  const el=document.getElementById('graph');
  if(!el || !simulation) return;
  // d3.forceCenter를 제거하여 화면 크기 변화에도 노드가 납치되지 않도록 조치
  simulation.alpha(0.1).restart();
});
svg.call(zoom.transform,d3.zoomIdentity);
renderGenderAge(null);

// ── 마인드맵 전체화면 동작 (Viewport CSS 기반으로 100% 신뢰성 확보) ─────────────────
let _savedScrollY = 0; // 전체화면 진입 전 스크롤 위치 저장

window.toggleFullscreen = function() {
  const outer = document.querySelector('.mindmap-outer');
  const fsBtn = document.getElementById('fs-btn');
  if(!outer) return;

  const isCurrentlyFS = outer.classList.contains('fullscreen-mode');

  if(!isCurrentlyFS) {
    // 전체화면 진입: 스크롤 위치 저장 후 고정
    _savedScrollY = window.scrollY;
    outer.classList.add('fullscreen-mode');
    if(fsBtn) fsBtn.textContent = '기본화면 ✖';
    document.body.style.overflow = 'hidden';
  } else {
    // 전체화면 종료: 클래스 제거 후 저장된 위치로 복원
    outer.classList.remove('fullscreen-mode');
    if(fsBtn) fsBtn.textContent = '전체화면 ⛶';
    document.body.style.overflow = '';
    // 종료 후 마인드맵 섹션 유지 (최상단으로 튀는 현상 방지)
    requestAnimationFrame(() => {
      window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
    });
  }

  // CSS reflow 완료 후(2프레임) updateGraph 호출 → 정확한 clientWidth/Height 사용
  requestAnimationFrame(() => requestAnimationFrame(() => updateGraph()));
};

// Esc 키로 탈출 가능하도록 추가
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const outer = document.querySelector('.mindmap-outer');
    if (outer && outer.classList.contains('fullscreen-mode')) toggleFullscreen();
  }
});
