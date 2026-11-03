// 댓글 → DM 자료 발송 (웹훅 서버 없이 몇 분마다 돌리는 방식). 의존 패키지 없이 Node만으로 돈다.
// 최근 게시물의 새 댓글 중 키워드가 들어간 댓글에 비공개 답장(DM)으로 자료 링크를 보내고, 댓글에 공개 답글을 단다.
// 사용법: node --env-file=.env dm.mjs            (실제 발송)
//         node --env-file=.env dm.mjs --dry-run  (누구에게 보낼지만 출력)
// 필요한 환경변수: FB_ACCESS_TOKEN(페이스북 로그인 토큰), IG_USER_ID, FB_PAGE_ID, (선택) DM_CAMPAIGNS 파일 경로
//
// 게시물별 키워드·자료와 문구는 dm-campaigns.json:
//   { "settings": { "message": "...{title}...{link}", "public_replies": [...], "max_per_run": 30 },
//     "<미디어 ID>": { "title": "...", "link": "https://...", "keyword": "(선택) 넣으면 이 단어가 들어간 댓글에만" } }
// keyword가 없으면 내용과 상관없이 모든 댓글(이모지·하트 포함)에 보낸다. 링크가 들어간 댓글은 스팸으로 보고 건너뛴다.
// 상태 파일 없이 중복을 막는다: 우리 계정 답글이 이미 달린 댓글은 처리한 것으로 본다.
// 인스타 규칙: 비공개 답장은 댓글당 1번, 댓글 작성 후 7일 이내만 가능.
import fs from "node:fs";

const env = (k) => {
  if (!process.env[k]) throw new Error(`환경변수가 없습니다: ${k}`);
  return process.env[k];
};
const dry = process.argv.includes("--dry-run");
const VERSION = process.env.GRAPH_VERSION ?? "v25.0";
const token = env("FB_ACCESS_TOKEN");
const me = env("IG_USER_ID");
const pageId = env("FB_PAGE_ID");
const file = process.env.DM_CAMPAIGNS ?? new URL("./state/dm-campaigns.json", import.meta.url);
const { settings = {}, ...campaigns } = JSON.parse(fs.readFileSync(file, "utf8"));
const WEEK = 7 * 24 * 3600_000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

async function api(method, path, params = {}, tok = token, json) {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${path}`);
  url.searchParams.set("access_token", tok);
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, method === "GET" ? {} : json
    ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }
    : { method, body: new URLSearchParams(params) });
  const body = await res.json();
  if (body.error) throw new Error(`${method} ${path}: ${JSON.stringify(body.error)}`);
  return body;
}

// 비공개 답장은 페이지 토큰으로 페이지의 messages 엔드포인트에 보낸다.
const { access_token: pageToken } = await api("GET", pageId, { fields: "access_token" });
const { username: myName } = await api("GET", me, { fields: "username" });

let sent = 0;
const max = settings.max_per_run ?? 30;
for (const [mediaId, c] of Object.entries(campaigns)) {
  if (!c.link) continue;
  let comments;
  try {
    comments = (await api("GET", `${mediaId}/comments`, { fields: "id,text,username,timestamp,replies{username}", limit: "50" })).data;
  } catch (e) {
    console.log(`댓글 읽기 실패 ${mediaId}: ${e.message.slice(0, 150)}`);
    continue;
  }
  for (const cm of comments) {
    if (sent >= max) break;
    if (cm.username === myName || Date.now() - new Date(cm.timestamp) > WEEK) continue;
    if (cm.replies?.data?.some((r) => r.username === myName)) continue; // 이미 처리한 댓글
    if (c.keyword && !norm(cm.text).includes(norm(c.keyword))) continue;
    if (/https?://|www.|.com/i.test(cm.text ?? "")) continue; // 링크 댓글은 스팸
    const text = (settings.message ?? "요청하신 자료 보내드려요 👇\n{title}\n{link}")
      .replaceAll("{title}", c.title ?? "").replaceAll("{link}", c.link).replaceAll("{username}", cm.username ?? "");
    if (dry) {
      console.log(`[dry-run] @${cm.username} "${cm.text}" → ${c.link}`);
      continue;
    }
    try {
      await api("POST", `${pageId}/messages`, {}, pageToken, { recipient: { comment_id: cm.id }, message: { text } });
      console.log(`DM 보냄: @${cm.username} (${mediaId})`);
    } catch (e) {
      // 이미 비공개 답장을 보낸 댓글이면 공개 답글만 달고 넘어간다. 그 밖의 오류는 다음 실행 때 다시 시도.
      if (!/already|이미/i.test(e.message)) {
        console.log(`DM 실패: @${cm.username} ${e.message.slice(0, 200)}`);
        continue;
      }
    }
    if (settings.public_replies?.length) {
      try {
        await api("POST", `${cm.id}/replies`, { message: pick(settings.public_replies).replace("{username}", cm.username ?? "") });
      } catch (e) {
        console.log(`공개 답글 실패: ${e.message.slice(0, 150)}`);
      }
    }
    sent++;
    await sleep(4000 + Math.random() * 4000); // 한꺼번에 몰아서 보내지 않도록 4~8초 간격
  }
}
console.log(dry ? "dry-run 끝" : `이번 실행 DM ${sent}건`);
