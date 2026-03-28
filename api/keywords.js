const crypto = require('crypto');

function makeSignature(timestamp, secretKey) {
  const message = `${timestamp}.GET./keywordstool`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword 파라미터가 필요합니다' });

  const customerId   = process.env.NAVER_CUSTOMER_ID;
  const clientId     = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!customerId || !clientId || !clientSecret)
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다' });

  const timestamp = Date.now().toString();
  const signature = makeSignature(timestamp, clientSecret);

  try {
    const url = 'https://api.naver.com/keywordstool'
      + '?hintKeywords=' + encodeURIComponent(keyword)
      + '&showDetail=1';

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

    const toNum = v => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v.replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };

    // 전체 stats 반환 (이름만 아니라 검색량·클릭수·CTR 포함)
    const keywords = (data.keywordList || [])
      .filter(item => item.relKeyword)
      .map(item => ({
        keyword:      item.relKeyword,
        pcVol:        toNum(item.monthlyPcQcCnt),
        mobileVol:    toNum(item.monthlyMobileQcCnt),
        totalVol:     toNum(item.monthlyPcQcCnt) + toNum(item.monthlyMobileQcCnt),
        pcClicks:     toNum(item.monthlyAvePcClkCnt),
        mobileClicks: toNum(item.monthlyAveMobileClkCnt),
        pcCtr:        toNum(item.monthlyAvePcCtr),
        mobileCtr:    toNum(item.monthlyAveMobileCtr),
        compIdx:      item.compIdx || '',
      }))
      .sort((a, b) => b.totalVol - a.totalVol)
      .slice(0, 100);

    return res.status(200).json({ keywords });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
