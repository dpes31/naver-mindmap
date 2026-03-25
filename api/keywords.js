const crypto = require('crypto');

// 네이버 Search Ads API 서명 생성
function makeSignature(timestamp, secretKey) {
  const message = `${timestamp}.GET./keywordstool`;
  return crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
}

module.exports = async (req, res) => {
  // CORS 허용 (브라우저에서 호출 가능하도록)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { keyword } = req.query;
  if (!keyword) {
    return res.status(400).json({ error: 'keyword 파라미터가 필요합니다' });
  }

  const customerId  = process.env.NAVER_CUSTOMER_ID;
  const clientId    = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!customerId || !clientId || !clientSecret) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다' });
  }

  const timestamp = Date.now().toString();
  const signature = makeSignature(timestamp, clientSecret);

  try {
    const url =
      'https://api.naver.com/keywordstool' +
      '?hintKeywords=' + encodeURIComponent(keyword) +
      '&showDetail=1';

    const response = await fetch(url, {
      headers: {
        'X-Timestamp':  timestamp,
        'X-API-KEY':    clientId,
        'X-Customer':   customerId,
        'X-Signature':  signature,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();

    // relKeyword 추출 → 월간 검색수 기준 정렬 → 상위 10개
    const keywords = (data.keywordList || [])
      .filter(item => item.relKeyword)
      .sort((a, b) => {
        const aVol = (Number(a.monthlyPcQcCnt)     || 0)
                   + (Number(a.monthlyMobileQcCnt) || 0);
        const bVol = (Number(b.monthlyPcQcCnt)     || 0)
                   + (Number(b.monthlyMobileQcCnt) || 0);
        return bVol - aVol;
      })
      .map(item => item.relKeyword)
      .slice(0, 10);

    return res.status(200).json({ keywords });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
