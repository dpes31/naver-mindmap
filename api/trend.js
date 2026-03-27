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

  // 최근 13개월
  const endD   = new Date();
  const startD = new Date(endD);
  startD.setMonth(startD.getMonth() - 12);
  startD.setDate(1);
  const fmt = d => d.toISOString().slice(0, 10);

  const base = {
    startDate: fmt(startD),
    endDate:   fmt(endD),
    timeUnit:  'month',
    keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
  };

  try {
    const [pc, mo, male, female] = await Promise.all([
      dlReq(cid, csec, { ...base, device: 'pc' }),
      dlReq(cid, csec, { ...base, device: 'mo' }),
      dlReq(cid, csec, { ...base, gender: 'm' }),
      dlReq(cid, csec, { ...base, gender: 'f' }),
    ]);

    const pcData = pc.results?.[0]?.data     || [];
    const moData = mo.results?.[0]?.data     || [];
    const mData  = male.results?.[0]?.data   || [];
    const fData  = female.results?.[0]?.data || [];

    const trend = pcData.map((pt, i) => ({
      period: pt.period.slice(0, 7), // YYYY-MM
      pc:  Math.round(pt.ratio * 10) / 10,
      mo:  Math.round((moData[i]?.ratio ?? 0) * 10) / 10,
    }));

    // 성별 비율: 최근 3개월 평균
    const avg = arr => {
      const s = arr.slice(-3); return s.length ? s.reduce((a,d)=>a+d.ratio,0)/s.length : 50;
    };
    const mAvg = avg(mData), fAvg = avg(fData);
    const tot  = (mAvg + fAvg) || 100;
    const gender = {
      male:   Math.round(mAvg / tot * 100),
      female: Math.round(100 - Math.round(mAvg / tot * 100)),
    };

    return res.status(200).json({ trend, gender });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
