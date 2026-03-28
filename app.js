// ── 설정 ──────────────────────────────────────────
const DEPTH_COLORS   = ['#1a56db', '#22c55e', '#f59e0b', '#8b5cf6'];
const CLUSTER_COLORS = ['#3b82f6','#16a34a','#f59e0b','#ec4899','#8b5cf6','#0ea5e9','#f97316'];
const DEPTH_RADIUS   = [44, 26, 18, 14];
const DEPTH_OPACITY  = [1, 0.92, 0.85, 0.80];
const MAX_DEPTH      = 2;
const MAX_D1         = 25;  // depth-1 최대
const MAX_D2_PARENTS = 5;   // depth-2 확장할 depth-1 수 (API 1배치)
const MAX_D2_PER     = 4;   // depth-2 부모당 최대
const MAX_LINKS_SHOW = 40;  // 표시 링크 최대
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
function scaleTrend(trend, pcAbs, moAbs) {
  if (!trend?.length) return trend;
  const avg3 = (arr,k) => { const s=arr.slice(-3); return s.reduce((a,d)=>a+d[k],0)/(s.length||1); };
  const pcRef = avg3(trend,'pc')||1, moRef = avg3(trend,'mo')||1;
  return trend.map(d=>({
    period:d.period,
    pc: pcAbs>0 ? Math.round(d.pc/pcRef*pcAbs) : Math.round(d.pc),
    mo: moAbs>0 ? Math.round(d.mo/moRef*moAbs) : Math.round(d.mo),
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

  const data = scaleTrend(trendData, pcAbsNow||0, moAbsNow||0);
  currentTrendData = data;

  if (legendEl) legendEl.innerHTML =
    `<div class="tl-item"><div class="tl-dot" style="background:#1a56db"></div>PC Desktop</div>
     <div class="tl-item"><div class="tl-dot" style="background:#16a34a"></div>Mobile</div>`;

  const margin={top:12,right:16,bottom:36,left:58};
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

  const yFmt=v=>v>=10000?(v/10000).toFixed(1)+'만':v>=1000?(v/1000).toFixed(0)+'천':v;
  const yAx=svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(yFmt));
  yAx.selectAll('text').attr('font-size',10).attr('fill','#6b7280');
  yAx.select('.domain').attr('stroke','#e5e7eb');

  [['mo','#16a34a'],['pc','#1a56db']].forEach(([k,c])=>{
    svg.append('path').datum(data)
      .attr('d',d3.area().x(xPos).y0(h).y1(d=>y(d[k])).curve(d3.curveMonotoneX))
      .attr('fill',c).attr('fill-opacity',0.07);
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
  hoverG.append('circle').attr('class','h-dot-pc').attr('r',6).attr('fill','#1a56db').attr('stroke','#fff').attr('stroke-width',2);
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
        <div class="ct-row"><span class="ct-dot" style="background:#1a56db"></span>PC Desktop<b>${d.pc.toLocaleString()}건</b></div>
        <div class="ct-row"><span class="ct-dot" style="background:#16a34a"></span>mobile<b>${d.mo.toLocaleString()}건</b></div>`;
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

// ── 노드 반경 (sibling 수에 따라 가변) ───────────────────
function nodeRadius(d) {
  const siblings = nodes.filter(n=>n.depth===d.depth).length;
  // 형제 노드 수에 따라 기본 크기를 줄임 (최소 0.4x)
  const sf = Math.max(0.4, Math.min(1, 16 / Math.max(siblings, 1)));
  const base = Math.round(DEPTH_RADIUS[Math.min(d.depth,3)] * sf);
  const fs   = d.depth===0 ? 13 : d.depth===1 ? Math.max(8, 11*sf) : Math.max(7, 10*sf);
  const textMin = Math.max(base, d.label.length * fs * 0.55 + 8);
  if (!d.totalVol) return textMin;
  const same = nodes.filter(n=>n.depth===d.depth&&n.totalVol>0);
  if (!same.length) return textMin;
  const maxV = Math.max(...same.map(n=>n.totalVol),1);
  const scale = Math.log1p(d.totalVol)/Math.log1p(maxV);
  return Math.max(textMin, base+(scale-0.5)*10*sf);
}

function linkWidth(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  const base = t?.depth===1 ? 2 : t?.depth===2 ? 1.5 : 1.2;
  // 검색량 있으면 두께도 비례 보정 (+0 ~ +0.8)
  if (t?.totalVol > 0) {
    const same = nodes.filter(n=>n.depth===t.depth&&n.totalVol>0);
    const maxV = Math.max(...same.map(n=>n.totalVol), 1);
    const ratio = Math.log1p(t.totalVol) / Math.log1p(maxV);
    return +(base + ratio * 0.8).toFixed(2);
  }
  return base;
}

function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
// 링크 색: depth 기준 (노드와 동일 depth 색)
function linkColor(d) {
  const t=nodes.find(n=>n.id===(d.target?.id||d.target));
  if (!t) return 'rgba(160,174,192,0.20)';
  const col=DEPTH_COLORS[Math.min(t.depth,3)];
  const s=d.strength||0.3;
  const alpha=Math.min(0.65, 0.15+s*1.6);
  return hexToRgba(col,alpha);
}

// ── 연관성 점수 (API 순위 × 검색량) ─────────────────────
function relevanceScore(item, idx) {
  const posScore = 1 / (idx + 1);
  const volScore = Math.log1p(item.totalVol||0) / Math.log1p(500000);
  return +(posScore * 0.55 + volScore * 0.45).toFixed(4);
}

// ── 의미 기반 클러스터 레이블 추출 ──────────────────────────
// 루트 키워드를 제거한 잉여 토큰의 빈도로 주제어 결정
function extractClusterLabel(items, rootKw) {
  const freq={};
  items.forEach(item=>{
    const kw=item.keyword||item.label||'';
    // 루트 키워드 제거 (부분 매치 포함)
    let residual=kw;
    for(let len=rootKw.length; len>=2; len--) {
      const p=rootKw.slice(0,len);
      if(kw.includes(p)){residual=kw.replace(p,'').trim();break;}
    }
    if(residual===kw||!residual) residual=kw;
    // 2~3글자 토큰 빈도 집계
    for(let len=2;len<=3;len++) {
      for(let i=0;i<=residual.length-len;i++) {
        const tok=residual.slice(i,i+len).trim();
        if(tok.length===len) freq[tok]=(freq[tok]||0)+1;
      }
    }
  });
  // 2개 이상 키워드에 등장한 토큰 중 가장 빈출
  const best=Object.entries(freq)
    .filter(([,cnt])=>cnt>=Math.min(2,items.length))
    .sort((a,b)=>b[1]-a[1]);
  // 3글자 우선, 없으면 2글자
  const b3=best.find(([t])=>t.length===3);
  const b2=best.find(([t])=>t.length===2);
  const label=b3?.[0]||b2?.[0]||'';
  if(label) return label;
  // fallback: 가장 높은 점수 키워드의 마지막 2글자
  const rep=[...items].sort((a,b)=>(b._score||0)-(a._score||0))[0];
  const repKw=rep?.keyword||rep?.label||'';
  return repKw.replace(rootKw,'').trim().slice(0,3)||repKw.slice(-3)||repKw.slice(0,3);
}

// ── 바이그램 클러스터링 ──────────────────────────────────
function bigrams(str) {
  const s = new Set();
  for (let i=0; i<str.length-1; i++) s.add(str.slice(i,i+2));
  return s;
}
function bigramSim(a, b) {
  const ba=bigrams(a), bb=bigrams(b);
  const union=new Set([...ba,...bb]).size||1;
  return [...ba].filter(g=>bb.has(g)).length / union;
}
function buildClusters(items, rootKw='') {
  const MAX_CL=7, MIN_SIM=0.18;
  const clusters=[];
  [...items].sort((a,b)=>(b._score||0)-(a._score||0)).forEach(item=>{
    const kw=item.keyword||item.label||'';
    let best=null, bestSim=MIN_SIM;
    clusters.forEach(c=>{
      const avg=(c.items.reduce((s,ci)=>s+bigramSim(kw,ci.keyword||ci.label||''),0)/c.items.length)||0;
      if(avg>bestSim){bestSim=avg;best=c;}
    });
    if(best&&best.items.length<9){best.items.push(item);}
    else if(clusters.length<MAX_CL){clusters.push({id:`cl-${clusters.length}`,items:[item],color:CLUSTER_COLORS[clusters.length%CLUSTER_COLORS.length]});}
    else{let b2=clusters[0],b2s=-1;clusters.forEach(c=>{const a=(c.items.reduce((s,ci)=>s+bigramSim(kw,ci.keyword||ci.label||''),0)/c.items.length)||0;if(a>b2s){b2s=a;b2=c;}});b2.items.push(item);}
  });
  clusters.forEach(c=>{
    c.totalScore=c.items.reduce((s,i)=>s+(i._score||0),0);
    // 의미 기반 레이블 (루트 키워드 제거 후 빈출 토큰)
    c.label=extractClusterLabel(c.items, rootKw)||c.items[0]?.keyword?.slice(0,4)||'기타';
  });
  return clusters.sort((a,b)=>b.totalScore-a.totalScore);
}

// ── 클러스터 헐(hull) 패스 ───────────────────────────────
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
    const dx=px-hcx, dy=py-hcy, d=Math.hypot(dx,dy)||1;
    return `${(px+dx/d*pad).toFixed(1)},${(py+dy/d*pad).toFixed(1)}`;
  });
  return `M${exp[0]} L${exp.slice(1).join(' L')} Z`;
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

const halosG=zoomG.append('g').attr('id','halos');
const linksG=zoomG.append('g').attr('id','links');
const nodesG=zoomG.append('g').attr('id','nodes');

function boundingForce() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||800, H=el.clientHeight||600, pad=60;
  nodes.forEach(n=>{
    if(n.depth===0) return;
    if(n.x<pad)    n.vx+=(pad-n.x)*0.12;
    if(n.x>W-pad)  n.vx+=(W-pad-n.x)*0.12;
    if(n.y<pad)    n.vy+=(pad-n.y)*0.12;
    if(n.y>H-pad)  n.vy+=(H-pad-n.y)*0.12;
  });
}

const simulation=d3.forceSimulation()
  .force('link',d3.forceLink().id(d=>d.id).distance(28).strength(0.5))
  .force('charge',d3.forceManyBody().strength(-90).distanceMax(200))
  .force('center',d3.forceCenter(400,300))
  .force('collision',d3.forceCollide().radius(d=>nodeRadius(d)+10))
  .force('bounds',boundingForce)
  .alphaDecay(0.018)
  .velocityDecay(0.30);

let nodes=[],links=[];
const nodeIds=new Set();
let isLoading=false;

// ── 그래프 렌더 ───────────────────────────────────────
function updateGraph() {
  const el=document.getElementById('graph');
  const W=el.clientWidth||800, H=el.clientHeight||600;

  const innerR = Math.min(W,H)*0.28;
  const outerR = Math.min(W,H)*0.46;
  const clCount = currentClusters.length||1;
  // 클러스터 섹터 중심 각도
  const clAngles = currentClusters.map((_,ci)=>(ci/clCount)*2*Math.PI - Math.PI/2);

  // 클러스터 내 노드를 깊이별로 분류 → 부채꼴 분산용 인덱스 계산
  const clMemberMap = {};
  nodes.forEach(n=>{
    if(n.depth===0||n.clusterIdx==null) return;
    const key=`${n.clusterIdx}-${n.depth}`;
    if(!clMemberMap[key]) clMemberMap[key]=[];
    clMemberMap[key].push(n.id);
  });
  // 클러스터 내 같은 depth 노드들을 부채꼴로 펼치는 각도 오프셋
  function nodeAngleOffset(n) {
    const key=`${n.clusterIdx}-${n.depth}`;
    const members=clMemberMap[key]||[];
    const idx=members.indexOf(n.id);
    const count=members.length;
    if(count<=1) return 0;
    // depth-1: ±35°, depth-2: ±25° 범위로 분산
    const spread=n.depth===1?(Math.PI/180*35):(Math.PI/180*25);
    return (idx/(count-1)-0.5)*2*spread;
  }

  // 노드별 목표 좌표 함수 (클러스터 중심 + 부채꼴 오프셋)
  function targetX(n) {
    if(n.depth===0||n.clusterIdx==null) return W/2;
    const angle=(clAngles[n.clusterIdx]||0)+nodeAngleOffset(n);
    return W/2+Math.cos(angle)*(n.depth===1?innerR:outerR);
  }
  function targetY(n) {
    if(n.depth===0||n.clusterIdx==null) return H/2;
    const angle=(clAngles[n.clusterIdx]||0)+nodeAngleOffset(n);
    return H/2+Math.sin(angle)*(n.depth===1?innerR:outerR);
  }
  // forceX/Y로 섹터 고정 (alpha 독립적으로 강하게 유지)
  simulation
    .force('clusterX', d3.forceX(targetX).strength(n=>n.depth===0?0:0.78))
    .force('clusterY', d3.forceY(targetY).strength(n=>n.depth===0?0:0.78))
    .force('radial',null);

  // 강도 상위 MAX_LINKS_SHOW개만 표시
  const shownLinks=[...links].sort((a,b)=>(b.strength||0)-(a.strength||0)).slice(0,MAX_LINKS_SHOW);
  const link=linksG.selectAll('line').data(shownLinks,d=>`${d.source?.id||d.source}→${d.target?.id||d.target}`);
  link.enter().append('line').attr('stroke-linecap','round');
  link.exit().remove();

  const node=nodesG.selectAll('g.node-group').data(nodes,d=>d.id);
  const enter=node.enter().append('g').attr('class','node-group')
    .style('opacity',0).style('cursor','pointer')
    .call(d3.drag()
      .on('start',(e,d)=>{if(!e.active)simulation.alphaTarget(0.1).restart();d.fx=d.x;d.fy=d.y;tooltipEl.classList.remove('visible');})
      .on('drag', (e,d)=>{d.fx=e.x;d.fy=e.y;
        if(e.sourceEvent){tooltipEl.style.left=(e.sourceEvent.clientX+14)+'px';tooltipEl.style.top=(e.sourceEvent.clientY-8)+'px';}})
      .on('end',  (e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}))
    .on('mouseenter',onHover).on('mouseleave',onLeave).on('click',onClick);

  // 노드 색: depth 기준 유지 (루트=파랑, 1차=초록, 2차=주황)
  enter.append('circle').attr('class','node-glow')
    .attr('r',d=>nodeRadius(d)+10)
    .attr('fill',d=>DEPTH_COLORS[Math.min(d.depth,3)])
    .attr('fill-opacity',d=>d.depth===2?0.05:0.08).attr('stroke','none');

  enter.append('circle').attr('class','node-circle')
    .attr('r',d=>nodeRadius(d))
    .attr('fill',d=>`url(#grad-${Math.min(d.depth,3)})`)
    .attr('stroke',d=>d.depth===2?'rgba(255,255,255,0.55)':'rgba(255,255,255,0.75)')
    .attr('stroke-width',d=>d.depth===0?3:d.depth===1?1.8:1.2)
    .attr('opacity',d=>d.depth===2?0.88:1);

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
  // depth에 따라 충돌 반경 차등: depth-1 넉넉히, depth-2 타이트하게
  simulation.force('collision').radius(d=>nodeRadius(d)+(d.depth===1?16:d.depth===2?8:20));
  simulation.force('center',d3.forceCenter(W/2,H/2));
  simulation.alpha(0.72).restart();

  linksG.selectAll('line')
    .attr('stroke',d=>linkColor(d))
    .attr('stroke-width',d=>linkWidth(d));

  let tickCount=0;
  simulation.on('tick',()=>{
    linksG.selectAll('line')
      .attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
      .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    nodesG.selectAll('g.node-group').attr('transform',d=>`translate(${d.x},${d.y})`);
    // 헐 업데이트: 매 4틱마다 (성능 최적화)
    if(tickCount++%4===0) renderHalos();
  });
}

// ── 클러스터 헐 렌더 ──────────────────────────────────────
function renderHalos() {
  halosG.selectAll('.ch').data(currentClusters,d=>d.id).join(
    enter=>enter.append('g').attr('class','ch').call(g=>{
      g.append('path').attr('class','ch-fill');
      // 레이블 배경 rect + 텍스트
      g.append('rect').attr('class','ch-label-bg').attr('rx',5).attr('ry',5);
      g.append('text').attr('class','ch-label-txt')
        .attr('text-anchor','middle').attr('font-size',11).attr('font-weight',700)
        .attr('fill','#fff').attr('pointer-events','none').attr('dy','0.35em');
    })
  ).each(function(cluster){
    const ci=currentClusters.indexOf(cluster);
    const cNodes=nodes.filter(n=>n.clusterIdx===ci&&n.x!=null&&!isNaN(n.x));
    if(!cNodes.length) return;
    const pts=cNodes.map(n=>[n.x,n.y]);
    // depth-1 노드가 있으면 넉넉한 padding, depth-2 전용이면 타이트하게
    const hasD1=cNodes.some(n=>n.depth===1);
    const repNode=cNodes.find(n=>n.depth===1)||cNodes[0];
    const pad=nodeRadius(repNode)+( hasD1 ? 24 : 16 );
    d3.select(this).select('.ch-fill')
      .attr('d',hullPath(pts,pad))
      .attr('fill',cluster.color).attr('fill-opacity',0.09)
      .attr('stroke',cluster.color).attr('stroke-width',1.8)
      .attr('stroke-opacity',0.38).attr('stroke-dasharray','none');
    // 레이블: hull 상단 중앙에 색상 배지
    const cx=d3.mean(pts,p=>p[0]);
    const minY=d3.min(pts,p=>p[1])-pad+8;
    const label=cluster.label||'';
    const tw=label.length*7.5+18; // 텍스트 너비 추정
    d3.select(this).select('.ch-label-bg')
      .attr('x',cx-tw/2).attr('y',minY-11)
      .attr('width',tw).attr('height',20)
      .attr('fill',cluster.color).attr('fill-opacity',0.85);
    d3.select(this).select('.ch-label-txt')
      .attr('x',cx).attr('y',minY)
      .text(label);
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
  const maxV = Math.max(d.pcVol, d.mobileVol, 1);
  const pcPct = d.pcVol ? Math.max(2, Math.round(d.pcVol/maxV*100)) : 0;
  const moPct = d.mobileVol ? Math.max(2, Math.round(d.mobileVol/maxV*100)) : 0;
  infoPanelEl.innerHTML=`
    <div class="info-card-header">
      <span class="info-kw">${d.label}</span>
      <span class="info-depth">${d.depth}차 연관어</span>
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

// ── 스마트 수집 (클러스터 기반, 2 API 배치) ─────────────────
async function collectAll(rootKeyword, rootId, prefetchedRoot) {
  const barEl=document.getElementById('progress-bar');
  const progEl=document.getElementById('loading-progress');
  function prog(pct,text){if(barEl)barEl.style.width=pct+'%';if(progEl)progEl.textContent=text;}

  prog(15,'키워드 스코어링 & 클러스터링...');

  // 연관성 점수 계산 + 상위 MAX_D1개 선택
  const scored=prefetchedRoot
    .map((item,idx)=>({...item,_score:relevanceScore(item,idx)}))
    .sort((a,b)=>b._score-a._score)
    .slice(0,MAX_D1);

  // 클러스터 생성 (루트 키워드 기반 의미 레이블 추출)
  currentClusters=buildClusters(scored, rootKeyword);
  prog(30,`${currentClusters.length}개 토픽 클러스터 생성 완료`);

  // depth-1 노드 추가 (클러스터 정보 포함)
  scored.forEach(item=>{
    const id=item.keyword.toLowerCase().trim();
    if(!id||nodeIds.has(id)) return;
    nodeIds.add(id);
    const ci=currentClusters.findIndex(c=>c.items.some(i=>(i.keyword||i.label||'')===(item.keyword||'')));
    const cluster=currentClusters[Math.max(0,ci)];
    nodes.push({id,label:item.keyword,depth:1,
      totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
      pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
      pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,
      compIdx:item.compIdx||'',
      clusterIdx:Math.max(0,ci),clusterColor:cluster?.color||CLUSTER_COLORS[0],
      _score:item._score});
    links.push({source:rootId,target:id,strength:item._score});
  });

  prog(50,`상위 ${MAX_D2_PARENTS}개 키워드 depth-2 수집 중...`);

  // depth-2: 점수 상위 MAX_D2_PARENTS개에 대해서만 1 배치로 병렬 수집
  const top=nodes.filter(n=>n.depth===1).sort((a,b)=>b._score-a._score).slice(0,MAX_D2_PARENTS);
  const results=await Promise.allSettled(top.map(n=>fetchNaverKeywords(n.label)));

  results.forEach((r,i)=>{
    prog(50+((i+1)/top.length)*45,`depth-2 (${i+1}/${top.length}) 처리 중...`);
    if(r.status!=='fulfilled') return;
    const parent=top[i];
    r.value.slice(0,MAX_D2_PER).forEach((item,idx)=>{
      const id=item.keyword.toLowerCase().trim();
      if(!id||nodeIds.has(id)) return;
      nodeIds.add(id);
      const sc=relevanceScore(item,idx)*0.5;
      nodes.push({id,label:item.keyword,depth:2,
        totalVol:item.totalVol||0,pcVol:item.pcVol||0,mobileVol:item.mobileVol||0,
        pcClicks:item.pcClicks||0,mobileClicks:item.mobileClicks||0,
        pcCtr:item.pcCtr||0,mobileCtr:item.mobileCtr||0,
        compIdx:item.compIdx||'',
        clusterIdx:parent.clusterIdx,clusterColor:parent.clusterColor,
        _score:sc});
      links.push({source:parent.id,target:id,strength:sc});
    });
  });

  prog(100,`${nodes.length}개 키워드 · ${currentClusters.length}개 클러스터`);
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
  const items=[keyword||'검색어','1차 연관','2차 연관','3차 연관'];
  const wrap=document.getElementById('mm-legend');
  wrap.innerHTML=items.map((t,i)=>
    `<div class="mm-legend-item"><div class="mm-dot" style="background:${DEPTH_COLORS[i]}"></div>${t}</div>`
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
