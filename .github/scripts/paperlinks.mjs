// 그날 1면 기사를 신문사별로 찾아 news/data/DATE.json 의 story.paperLinks 에 넣어요.
// 네이버 뉴스 검색 API로 찾고, 각 신문사 사이트 주소 + 날짜 + 핵심어가 맞을 때만 골라요.
import fs from 'node:fs';

const ID = process.env.NAVER_ID, SECRET = process.env.NAVER_SECRET;
if (!ID || !SECRET) { console.log('네이버 키가 아직 없어요. 건너뜀.'); process.exit(0); }

const DOM = {
  '경향신문': ['khan.co.kr'], '국민일보': ['kmib.co.kr'], '동아일보': ['donga.com'], '서울신문': ['seoul.co.kr'],
  '세계일보': ['segye.com'], '조선일보': ['chosun.com'], '중앙일보': ['joongang.co.kr'], '한겨레': ['hani.co.kr'],
  '한국일보': ['hankookilbo.com'], '디지털타임스': ['dt.co.kr'], '머니투데이': ['mt.co.kr'], '서울경제': ['sedaily.com'],
  '아주경제': ['ajunews.com'], '이데일리': ['edaily.co.kr'], '이투데이': ['etoday.co.kr'], '전자신문': ['etnews.com'],
  '파이낸셜뉴스': ['fnnews.com'], '한국경제': ['hankyung.com'],
};
// 같은 회사지만 다른 매체인 곳은 빼요
const EXCL = ['biz.chosun.com', 'sports.chosun.com', 'sports.donga.com', 'weekly.donga.com', 'magazine.hankyung.com', 'sports.hankooki.com'];

function paperOf(u) {
  let h; try { h = new URL(u).hostname.toLowerCase(); } catch { return null; }
  if (EXCL.some(x => h === x || h.endsWith('.' + x))) return null;
  for (const [p, ds] of Object.entries(DOM)) if (ds.some(d => h === d || h.endsWith('.' + d))) return p;
  return null;
}

const HANJA = { '韓': '한', '中': '중', '美': '미', '日': '일', '北': '북', '英': '영', '佛': '프랑스', '獨': '독일', '露': '러',
  '與': '여당', '野': '야당', '尹': '윤석열', '李': '이재명', '靑': '청와대', '檢': '검찰', '軍': '군', '對': '대', '株': '주식', '銀': '은행' };
const HRE = new RegExp('[' + Object.keys(HANJA).join('') + ']', 'g');
function norm(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/&(quot|apos|amp|lt|gt|#\d+);/g, ' ')
    .replace(HRE, c => HANJA[c]).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const JOSA = /(으로써|으로서|에서는|에게서|으로|에서|에게|까지|부터|이라|라고|이다|하고|보다|처럼|만큼|은|는|이|가|을|를|의|에|로|와|과|도|만)$/;
const STOP = new Set(['있다', '없다', '한다', '했다', '위해', '대한', '관련', '이번', '오늘', '지난', '결국', '만에', '통해', '이후', '모두', '정부', '대통령']);
function toks(t) {
  const out = [];
  for (let w of norm(t).split(' ')) {
    if (w.length > 2) w = w.replace(JOSA, '');
    w = w.toLowerCase();
    if (w.length >= 2 && !STOP.has(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

async function search(q, start = 1) {
  const url = 'https://openapi.naver.com/v1/search/news.json?display=100&sort=sim&start=' + start + '&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'X-Naver-Client-Id': ID, 'X-Naver-Client-Secret': SECRET } });
  if (!r.ok) { console.log('검색 실패', r.status, await r.text()); return []; }
  return (await r.json()).items || [];
}

function kstDay(d) { return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); }
function prevDay(s) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

async function run(date) {
  const file = `news/data/${date}.json`;
  if (!fs.existsSync(file)) { console.log('파일 없음', file); return false; }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw), story = data.story || {};
  const want = (story.papers || []).filter(p => DOM[p]);
  const have = new Set((story.links || []).map(paperOf).filter(Boolean)); // 직접 넣은 링크가 우선
  const need = want.filter(p => !have.has(p));
  if (!need.length) { console.log(date, '찾을 신문 없음'); return false; }

  const T = toks(story.title), S = toks(story.summary).filter(w => !T.includes(w)).slice(0, 14);
  const days = new Set([date, prevDay(date)]);
  const seen = new Map();
  const add = items => { for (const it of items) { const u = it.originallink || ''; if (u && !seen.has(u)) seen.set(u, it); } };

  const q1 = T.slice(0, 4).join(' '), q2 = [...T.slice(0, 2), ...S.slice(0, 2)].join(' ');
  add(await search(q1)); add(await search(q1, 101)); if (q2 && q2 !== q1) add(await search(q2));
  for (const p of need) add(await search(p + ' ' + T.slice(0, 3).join(' ')));

  const best = {};
  for (const [u, it] of seen) {
    const p = paperOf(u); if (!p || !need.includes(p)) continue;
    const pd = new Date(it.pubDate); if (isNaN(pd) || !days.has(kstDay(pd))) continue;
    const ti = norm(it.title).toLowerCase().replace(/\s/g, ''), all = ti + norm(it.description).toLowerCase().replace(/\s/g, '');
    const tHitTitle = T.filter(w => ti.includes(w)).length;
    const tHit = T.filter(w => all.includes(w)).length, sHit = S.filter(w => all.includes(w)).length;
    if (tHitTitle < 1 || tHit < 2) continue;
    if (tHit / Math.max(T.length, 1) < 0.35 && tHit * 2 + sHit < 7) continue;
    const score = tHitTitle * 3 + tHit * 2 + sHit;
    if (!best[p] || score > best[p].score) best[p] = { u, score, title: norm(it.title) };
  }

  const links = {};
  for (const p of need) if (best[p]) { links[p] = best[p].u; console.log(`  ✓ ${p}  [${best[p].score}] ${best[p].title}  ${best[p].u}`); }
  for (const p of need) if (!best[p]) console.log(`  · ${p}  못 찾음`);
  console.log(`${date}: ${Object.keys(links).length}/${need.length}곳 찾음 (직접 넣은 링크 ${have.size}곳 별도)`);

  if (JSON.stringify(links) === JSON.stringify(story.paperLinks || {})) return false;
  story.paperLinks = links;
  data.story = story;
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return true;
}

let dates = process.argv.slice(2).join(' ').split(/[\s,]+/).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
if (!dates.length) { const idx = JSON.parse(fs.readFileSync('news/data/index.json', 'utf8')); dates = [[...idx.dates].sort().pop()]; }
let changed = false;
for (const d of dates) changed = (await run(d)) || changed;
console.log(changed ? '바뀐 내용 있음' : '바뀐 내용 없음');
