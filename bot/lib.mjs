// 공통 함수 모음: Claude 원고 생성·검수, 슬라이드 렌더링, 이미지 업로드, Instagram API 호출.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const GRAPH_HOST = process.env.GRAPH_HOST ?? "https://graph.instagram.com";
const GRAPH_VERSION = process.env.GRAPH_VERSION ?? "v23.0";

export function loadConfig() {
  return JSON.parse(fs.readFileSync(new URL("./config.json", import.meta.url), "utf8"));
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`환경변수가 없습니다: ${missing.join(", ")} (.env.example 참고)`);
}

// ---------- Claude ----------

const claude = () => new Anthropic();

// Claude Opus 5.5가 요청을 거절하면 서버가 자동으로 다른 모델로 재시도한다(fallbacks: "default").
// user는 문자열 또는 이미지·텍스트 블록 배열.
export async function askClaude(system, user, schema, effort = "medium") {
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error(`Claude가 거절: ${res.stop_details?.explanation ?? ""}`);
  if (!res.parsed_output) throw new Error(`JSON 파싱 실패 (stop_reason: ${res.stop_reason})`);
  return res.parsed_output;
}

const ask = askClaude;

// analyze.mjs --ai 로 모은 레퍼런스 공식을 원고 작성에 참고시킨다(문장은 베끼지 않게).
function referenceNotes() {
  const root = new URL("./references/", import.meta.url);
  if (!fs.existsSync(root)) return "";
  const notes = fs.readdirSync(root).flatMap((h) => {
    const f = new URL(`./references/${h}/insights.json`, import.meta.url);
    if (!fs.existsSync(f)) return [];
    const i = JSON.parse(fs.readFileSync(f, "utf8"));
    return [`[@${h}] 공식: ${i.content_formulas.join(" / ")}\n제목 패턴: ${i.hook_patterns.join(" / ")}\n피할 것: ${i.avoid.join(" / ")}`];
  });
  if (!notes.length) return "";
  return `\n\n참고할 레퍼런스 계정 분석 (구조와 공식만 참고하고 문장·표현은 절대 그대로 쓰지 않는다)\n${notes.join("\n\n")}`;
}

export const Carousel = z.object({
  hook_title: z.string().describe("1번 슬라이드 제목. 20자 안팎, 숫자나 구체적 결과 포함. 강조할 단어는 **단어**, 줄바꿈은 \\n"),
  hook_sub: z.string().describe("1번 슬라이드 보조 문장. 왜 넘겨봐야 하는지"),
  cover_image: z.string().optional().describe("표지 배경 이미지 파일 경로(선택)"),
  slides: z.array(z.object({
    headline: z.string().describe("섹션 제목 12자 이내"),
    body: z.string().describe("items가 없을 때 본문"),
    items: z.array(z.object({ title: z.string(), body: z.string() })).optional().describe("카드 4~10개. title 10자, body 45자 이내"),
  })).describe("본문 슬라이드"),
  cta_title: z.string().describe("마지막 슬라이드 제목. 강조할 단어는 **단어**"),
  cta_sub: z.string().optional().describe("마지막 슬라이드 보조 문장"),
  outro_image: z.string().optional().describe("마지막 장 배경 이미지 파일 경로(선택)"),
  caption: z.string().describe("캡션. 첫 줄에 검색 키워드, 3~6줄. 댓글 키워드 안내 문장 포함"),
  hashtags: z.array(z.string()).describe("주제에 딱 맞는 해시태그 최대 5개, # 포함"),
  guide: z.any().optional().describe("DM으로 보낼 자료 페이지 전체 내용 (guides/README 형식)"),
  guide_slug: z.string().optional().describe("이미 있는 자료 페이지를 쓸 때 그 slug"),
});

// 댓글만 달면(내용 상관없이) DM으로 자료를 보내는 구조의 안내 문장
export const DM_CTA = "댓글을 남겨주시면 전체 자료를 DM으로 보내드려요";

// 캡션 마지막 CTA. 받을 자료(lead_magnet)가 없으면 자료를 약속하지 않는다.
export const ctaLine = (cfg) =>
  cfg.lead_magnet
    ? `댓글에 "${cfg.comment_keyword}" 남기면 ${cfg.lead_magnet} 보내드려요`
    : "도움 됐다면 저장해 두고, 매일 받아보려면 팔로우해 주세요";

// 원고 작성 지시문. API 호출(writeCarousel)과 무료 방식(daily.mjs --brief)이 같은 지시문을 쓴다.
export function writeSystem(cfg) {
  return `너는 한국어 인스타그램 정보성 캐러셀 작가다.
계정 주제: ${cfg.niche}
말투: ${cfg.tone}

원칙
- 인터넷에 흔한 말을 반복하지 말고 바로 따라 할 수 있는 구체적 행동·예시를 쓴다.
- 1번 슬라이드는 스크롤을 멈추게 하는 약속 하나만 담는다. hook_title은 2~3줄(\\n), 숫자와 핵심 단어 1~2개를 **단어**로 강조.
- 게시물은 맛보기, 전체는 DM으로 보내는 자료 페이지(guide)에 담는다. 이미지에 다 주면 댓글을 달 이유가 없다.
- 본문 슬라이드는 2장. 각 장은 섹션 하나: headline(12자 이내) + items 카드 8개(title 10자, body 45자 이내, 그대로 복사해 쓰는 프롬프트의 앞부분이나 구체적 행동). body는 빈 문자열.
- 카드 번호는 자동으로 이어 붙으니 넣지 않는다. 표지 제목의 개수는 자료 페이지 전체 프롬프트 수에 맞춘다.
- cta_title은 3줄(\\n), 둘째 줄을 **강조**, 마지막 줄은 "댓글 남기고 받아가기". cta_sub는 쓰지 않는다(DM 안내가 자동으로 들어감).
- guide(자료 페이지): { "title": 표지와 같은 제목(\\n·**강조** 가능), "category": "업무 프롬프트", "summary": [왜 어려운지 한 줄, 이 자료에 담긴 것 한 줄],
  "free_sections": 2, "sections": [ { "label": "PART 1 · 3분", "title", "lead": 쓰는 법 한두 줄, "prompts": [ { "name", "text": [ ] 빈칸이 있는 완성 프롬프트 3~6줄, "success": 성공하면 무엇이 나오는지(선택) } ] } 를 3~4개,
  보너스 1~2개: { "label": "보너스 1", "title", "lead", "text_name": "파일이름.TXT", "text": 그대로 쓰는 양식 } 또는 { "label": "보너스 2", "title", "lead", "table": { "head": [...], "rows": [[...]] } } ],
  "faq": [ { "q", "a" } 3~4개 ] }
- 자료 페이지 프롬프트는 무료 클로드·챗GPT에 붙여 한 번에 결과가 나오도록 쓴다. 특정 기능에 기대지 말고 [ ] 빈칸과 출력 형식(표·목록·분량)을 정확히 지정한다.
- 확인되지 않은 통계, 출처 없는 수치, 존재하지 않는 기능은 절대 쓰지 않는다.
- 캡션 마지막 줄에 "${DM_CTA}" 문장을 넣는다.
- 해시태그는 5개 이하.${referenceNotes()}`;
}

export function trimCarousel(c) {
  c.slides = c.slides.slice(0, 8); // 표지 + 본문 8 + CTA = 최대 10장(API 한도)
  c.hashtags = c.hashtags.slice(0, 5);
  return c;
}

export async function writeCarousel(topic, cfg) {
  return trimCarousel(await ask(writeSystem(cfg), `주제: ${topic}`, Carousel));
}

const Review = z.object({
  ok: z.boolean().describe("그대로 게시해도 되면 true"),
  problems: z.array(z.string()).describe("사실 오류, 과장, 어색한 문장, 규칙 위반 목록"),
});

// 사람이 검수하지 않는 대신 Claude가 한 번 더 검수한다.
export function reviewSystem(cfg) {
  return `너는 깐깐한 편집자다. 아래 인스타 캐러셀 원고를 검수한다.
불합격 기준: 사실이 틀렸거나 확인할 수 없는 수치, 존재하지 않는 기능·메뉴, 과장 광고 문구,
의료·법률·투자 단정, 다른 사람이나 브랜드 비방, 맞춤법 오류, 계정 주제(${cfg.niche})와 무관한 내용.
사소한 표현 취향은 문제로 적지 않는다.`;
}

export async function reviewCarousel(c, cfg) {
  return ask(reviewSystem(cfg), JSON.stringify(c, null, 2), Review, "high");
}

const Topic = z.object({ topic: z.string() });

export const nextQueuedTopic = (cfg, used) => (cfg.topics ?? []).find((t) => !used.includes(t));

export async function pickTopic(cfg, used) {
  const queued = nextQueuedTopic(cfg, used);
  if (queued) return queued;
  const { topic } = await ask(
    `너는 인스타그램 콘텐츠 기획자다. 계정 주제: ${cfg.niche}`,
    `이미 올린 주제:\n${used.slice(-60).join("\n") || "(없음)"}\n\n겹치지 않으면서 팔로워가 친구에게 보내고 싶어질 새 캐러셀 주제 하나를 한 줄로.`,
    Topic,
  );
  return topic;
}

const Replies = z.object({
  replies: z.array(z.object({ id: z.string(), reply: z.string().describe("빈 문자열이면 답글 생략") })),
});

export async function draftReplies(comments, cfg) {
  const system = `너는 인스타 계정(${cfg.niche}) 운영자다. 댓글마다 짧고 따뜻한 답글을 쓴다.
- 1~2문장, 이모지는 최대 1개. 같은 문장 반복 금지(댓글 내용을 짚어서 쓴다).
- 질문이면 핵심만 답하고, 모르면 "다음 콘텐츠로 정리해볼게요"라고 한다.
- 키워드 댓글(${cfg.comment_keyword})에는 "DM 확인해주세요!" 류로 짧게.
- 스팸·욕설·광고 댓글은 reply를 빈 문자열로.`;
  const { replies } = await ask(system, JSON.stringify(comments.map(({ id, text }) => ({ id, text }))), Replies, "low");
  return replies;
}

// ---------- 렌더링 ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// 제목 안의 **단어**는 강조색으로 칠한다.
const marked = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
const plain = (s) => String(s).replace(/\*\*/g, "");

const SLIDE_CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1350px;font-family:Pretendard,sans-serif;background:var(--bg);color:#fff;word-break:keep-all}
em{font-style:normal;color:var(--accent)}
.page{position:relative;width:1080px;height:1350px;overflow:hidden;background:var(--bg)}
.foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;align-items:center;justify-content:space-between;font-size:30px;z-index:3}
.brand{display:flex;align-items:center;gap:14px;font-weight:600;color:#fff;opacity:.92}
.logo{width:46px;height:46px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900;font-size:24px}
.next{color:var(--accent);font-weight:700}
.dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#fff;opacity:.28}.dots i.on{opacity:1;background:var(--accent)}
/* 표지·마지막 장: 전면 이미지 + 아래 검정 그라데이션 + 큰 제목 */
/* 생성 이미지는 주인공이 가운데쯤 있어 제목에 가리지 않도록 위로 올린다.
   상자를 1150px로 줄여 이미지 아래 14%(Gemini 표시가 있는 오른쪽 아래 구석)는 잘라내고, 끝은 부드럽게 흐린다. */
.hero .bg{position:absolute;left:0;right:0;top:-100px;height:1150px;background-size:cover;background-position:center top;-webkit-mask-image:linear-gradient(180deg,#000 82%,transparent)}
.hero .bg.fallback{background:radial-gradient(900px 700px at 70% 22%,var(--accent) 0%,transparent 60%),radial-gradient(700px 600px at 10% 10%,#3b2cff 0%,transparent 60%),#0b0b10;opacity:.95}
.hero .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 38%,rgba(0,0,0,.8) 60%,#000 72%)}
.hero .txt{position:absolute;left:72px;right:72px;bottom:190px;z-index:2}
.hero h1{font-size:118px;font-weight:900;line-height:1.1;letter-spacing:-3px}
.hero p{margin-top:28px;font-size:40px;font-weight:500;color:#cfcfd6;line-height:1.4}
.hero.outro h1{font-size:104px}
/* 본문: 섹션 머리 + 카드 그리드 */
.grid-page{padding:72px 72px 0}
.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px}
.head .l{display:flex;align-items:center;gap:22px}
.badge{background:var(--accent);color:#fff;font-weight:900;font-size:40px;border-radius:16px;padding:6px 18px}
.head h2{font-size:58px;font-weight:900;letter-spacing:-1.5px}
.head .range{font-size:30px;color:var(--muted);font-weight:600}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:30px 30px 32px}
.card b{display:block;font-size:34px;font-weight:800;margin-bottom:12px;letter-spacing:-.5px}
.card b span{color:var(--accent);margin-right:12px}
.card p{font-size:27px;line-height:1.5;color:var(--muted)}
.cards.wide{grid-template-columns:1fr}
.cards.wide .card p{font-size:32px}
.note{position:absolute;left:72px;right:72px;bottom:150px;padding-top:30px;border-top:2px dashed var(--line);font-size:38px;font-weight:800}
.lead{font-size:44px;line-height:1.55;color:#d9d9e0;margin-top:20px}`;

const progress = (i, n) => `<div class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>`;
const imageUrl = (f) => (f && fs.existsSync(f) ? `url('data:image/${path.extname(f).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(f).toString("base64")}')` : null);

// 원고에 이미지가 없으면 images/<kind>/<장면>/ 폴더(없으면 images/<kind>/)에서 주제마다 고정된 한 장을 고른다.
// 장면은 config.json topic_scene에서 주제별로 정한다.
export function pickImage(kind, topic, scene) {
  const base = fileURLToPath(new URL(`./images/${kind}/`, import.meta.url));
  const images = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => path.join(dir, f)) : []);
  const list = (scene && images(path.join(base, scene)).length) ? images(path.join(base, scene)) : images(base);
  if (!list.length) return null;
  const n = [...String(topic)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return list[n % list.length];
}

function slideHtml(p, i, n, cfg) {
  const brand = `<div class="brand"><div class="logo">${esc(cfg.logo ?? cfg.handle.replace("@", "")[0].toUpperCase())}</div>${esc(cfg.handle.replace("@", ""))}</div>`;
  if (p.kind === "cover" || p.kind === "outro") {
    const img = imageUrl(p.image);
    const right = p.kind === "cover" ? `<span class="next">넘겨서 보기 →</span>` : `<span class="next">저장하고 공유하기</span>`;
    return `<div class="page hero ${p.kind}"><div class="bg ${img ? "" : "fallback"}" style="${img ? `background-image:${img}` : ""}"></div><div class="shade"></div>
<div class="txt"><h1>${marked(p.title)}</h1>${p.body ? `<p>${esc(p.body)}</p>` : ""}</div>
<div class="foot">${brand}${progress(i, n)}${right}</div></div>`;
  }
  const items = p.items?.length ? p.items : [{ title: plain(p.title), body: p.body }];
  const note = p.note ? `<div class="note">${marked(p.note)}</div>` : "";
  return `<div class="page grid-page"><div class="head"><div class="l"><span class="badge">${String(p.section).padStart(2, "0")}</span><h2>${esc(plain(p.title))}</h2></div>${p.range ? `<span class="range">${esc(p.range)}</span>` : ""}</div>
<div class="cards ${items.length <= 4 ? "wide" : ""}">${items.map((it) => `<div class="card"><b>${it.num ? `<span>${esc(it.num)}</span>` : ""}${esc(it.title)}</b><p>${esc(it.body)}</p></div>`).join("")}</div>
${note}<div class="foot">${brand}${progress(i, n)}<span class="next">넘겨서 보기 →</span></div></div>`;
}

// Graph API 이미지는 JPEG만, 비율은 4:5~1.91:1.
// 본문 장에 items가 있으면 카드 그리드로, 없으면 headline·body 한 장 카드로 그린다.
export async function renderSlides(c, dir, cfg) {
  const { chromium } = await import("playwright");
  const { bg, accent, card = "#1a1a20", line = "#26262e", muted = "#b9b9c2" } = cfg.colors;
  const vars = `:root{--bg:${bg};--accent:${accent};--card:${card};--line:${line};--muted:${muted}}`;
  const note = c.dm_note ?? null;
  let num = 0;
  const pages = [
    { kind: "cover", title: c.hook_title, body: c.hook_sub, image: c.cover_image ?? pickImage("cover", c.hook_title, cfg.topic_scene?.[c.topic]) },
    ...c.slides.map((s, k) => {
      const items = s.items?.map((it) => ({ ...it, num: String(++num) }));
      const range = items?.length > 1 ? `${items[0].num}–${items.at(-1).num}` : null;
      return { kind: "body", title: s.headline, body: s.body, items, range, section: k + 1, note };
    }),
    { kind: "outro", title: c.cta_title, body: c.cta_sub ?? ctaLine(cfg), image: c.outro_image ?? pickImage("outro", c.hook_title, cfg.topic_scene?.[c.topic]) },
  ];
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const files = [];
  for (const [i, p] of pages.entries()) {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${SLIDE_CSS}${vars}</style></head><body>${slideHtml(p, i, pages.length, cfg)}</body></html>`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 92 });
    files.push(file);
  }
  await browser.close();
  return files;
}

// ---------- 이미지 업로드 (S3 호환: Cloudflare R2, AWS S3 등 / 무료: 공개 GitHub 저장소) ----------

// SLIDES_GIT_DIR: 공개 GitHub 저장소를 clone해 둔 폴더. 이미지를 커밋·푸시하고 raw 주소를 돌려준다.
function uploadToGit(files, prefix) {
  const repo = process.env.SLIDES_GIT_DIR;
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" }).toString().trim();
  fs.mkdirSync(path.join(repo, prefix), { recursive: true });
  for (const file of files) fs.copyFileSync(file, path.join(repo, prefix, path.basename(file)));
  git("add", prefix);
  git("commit", "-m", `slides ${prefix}`);
  git("push", "origin", "HEAD");
  const [, owner, name] = git("remote", "get-url", "origin").match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  return files.map((f) => `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${prefix}/${path.basename(f)}`);
}

export async function uploadImages(files, prefix) {
  if (process.env.SLIDES_GIT_DIR) return uploadToGit(files, prefix);
  requireEnv("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "PUBLIC_BASE_URL");
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
  const urls = [];
  for (const file of files) {
    const key = `${prefix}/${path.basename(file)}`;
    await s3.send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: fs.readFileSync(file), ContentType: "image/jpeg" }),
    );
    urls.push(`${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`);
  }
  return urls;
}

// ---------- Instagram API ----------

export async function graph(method, endpoint, params = {}, json) {
  const token = process.env.IG_ACCESS_TOKEN;
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${endpoint}`);
  let res;
  if (method === "GET") {
    for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v);
    res = await fetch(url);
  } else if (json) {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  } else {
    res = await fetch(url, { method, body: new URLSearchParams({ ...params, access_token: token }) });
  }
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`${method} ${endpoint}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}

export async function publishCarousel(urls, caption) {
  requireEnv("IG_USER_ID", "IG_ACCESS_TOKEN");
  const me = process.env.IG_USER_ID;
  const children = [];
  for (const image_url of urls) {
    children.push((await graph("POST", `${me}/media`, { image_url, is_carousel_item: "true" })).id);
  }
  const { id } = await graph("POST", `${me}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  for (let i = 0; i < 30; i++) {
    const { status_code } = await graph("GET", id, { fields: "status_code" });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`컨테이너 상태: ${status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return (await graph("POST", `${me}/media_publish`, { creation_id: id })).id;
}

export function verifySignature(rawBody, header, appSecret) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// ---------- 간단한 상태 저장 ----------

export function store(name, fallback) {
  const file = new URL(`./state/${name}.json`, import.meta.url);
  fs.mkdirSync(new URL("./state/", import.meta.url), { recursive: true });
  return {
    read: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback),
    write: (v) => fs.writeFileSync(file, JSON.stringify(v, null, 2)),
  };
}

export function slugify(topic) {
  return (
    new Date().toISOString().slice(0, 10) +
    "-" +
    topic.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40)
  );
}
