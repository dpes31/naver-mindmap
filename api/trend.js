const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

async function dlReq(id, secret, body) {
  const r = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`DataLab ${r.status}: ${await r.text()}`);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  const cid  = process.env.NAVER_DATALAB_CLIENT_ID;
  const csec = process.env.NAVER_DATALAB_CLIENT_SECRET;
  if (!cid || !csec)
    return res.status(500).json({ error: 'NAVER_DATALAB_CLIENT_ID / NAVER_DATALAB_CLIENT_SECRET 환경변수 미설정' });

  const now    = new Date();
  // 전월 말일 (날짜 오버플로우 없이 안전하게 계산)
  const endD   = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  // 12개월 전 1일 — setMonth() 대신 생성자로 직접 계산하여 날짜 오버플로우 방지
  const startD = new Date(endD.getFullYear(), endD.getMonth() - 11, 1);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  // 트렌드 마지막 포인트의 월 (전월)
  const lastTrendMonth = `${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,'0')}`;
  const fmt = d => d.toISOString().slice(0, 10);
  const base = {
    startDate: fmt(startD),
    endDate:   fmt(endD),
    timeUnit:  'month',
    keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
  };

  const ageGroups = [
    { label: '10대',  ages: ['2'] },
    { label: '20대',  ages: ['3', '4'] },
    { label: '30대',  ages: ['5', '6'] },
    { label: '40대',  ages: ['7', '8'] },
    { label: '50대+', ages: ['9', '10', '11'] },
  ];

  try {
    // 11개 병렬 호출: 추이(pc/mo) + 성별×디바이스(4) + 연령(5)
    const [
      pcTrend, moTrend,
      mPc, fPc, mMo, fMo,
      ...ageResults
    ] = await Promise.all([
      dlReq(cid, csec, { ...base, device: 'pc' }),
      dlReq(cid, csec, { ...base, device: 'mo' }),
      dlReq(cid, csec, { ...base, device: 'pc', gender: 'm' }),
      dlReq(cid, csec, { ...base, device: 'pc', gender: 'f' }),
      dlReq(cid, csec, { ...base, device: 'mo', gender: 'm' }),
      dlReq(cid, csec, { ...base, device: 'mo', gender: 'f' }),
      ...ageGroups.map(ag => dlReq(cid, csec, { ...base, ages: ag.ages })),
    ]);

    // 추이 (DataLab 상대지수 0-100 그대로 반환 — 프론트에서 절대값으로 스케일)
    const pcData = pcTrend.results?.[0]?.data || [];
    const moData = moTrend.results?.[0]?.data || [];
    const trend  = pcData.map((pt, i) => ({
      period: pt.period.slice(0, 7),
      pc: +(pt.ratio.toFixed(2)),
      mo: +((moData[i]?.ratio ?? 0).toFixed(2)),
    })).filter(d => d.period < currentMonth);

    // 성별 (최근 3개월 평균)
    const avg3 = arr => {
      const s = (arr.results?.[0]?.data || []).slice(-3);
      return s.length ? s.reduce((a, d) => a + d.ratio, 0) / s.length : 0;
    };
    const mPcAvg = avg3(mPc), fPcAvg = avg3(fPc);
    const mMoAvg = avg3(mMo), fMoAvg = avg3(fMo);
    const pcTot  = (mPcAvg + fPcAvg) || 1;
    const moTot  = (mMoAvg + fMoAvg) || 1;
    const ovTot  = (mPcAvg + fPcAvg + mMoAvg + fMoAvg) || 1;
    const gender = {
      male:     +((mPcAvg + mMoAvg) / ovTot * 100).toFixed(1),
      female:   +((fPcAvg + fMoAvg) / ovTot * 100).toFixed(1),
      malePc:   +(mPcAvg / pcTot * 100).toFixed(1),
      femalePc: +(fPcAvg / pcTot * 100).toFixed(1),
      maleMo:   +(mMoAvg / moTot * 100).toFixed(1),
      femaleMo: +(fMoAvg / moTot * 100).toFixed(1),
    };

    // 연령별
    const ageAvgs = ageGroups.map((ag, i) => ({
      label: ag.label,
      val: avg3(ageResults[i]),
    }));
    const ageTot = ageAvgs.reduce((s, a) => s + a.val, 0) || 1;
    const ages = {};
    ageAvgs.forEach(({ label, val }) => { ages[label] = +(val / ageTot * 100).toFixed(1); });

    return res.status(200).json({ trend, gender, ages, lastTrendMonth });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
