// DM으로 보내는 자료 사이트를 만든다. guides/*.json 하나가 자료 페이지 하나.
// 사용법: node guides.mjs            → site/ 에 정적 페이지 생성 (index = DM 못 받은 분용 목록)
//         node guides.mjs --publish  → SLIDES_GIT_DIR 공개 저장소에 올림 (GitHub Pages)
// 자료 JSON 형식은 guides/README.md 참고.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "./lib.mjs";

const cfg = loadConfig();
const SRC = "guides";
const OUT = "site";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const oneLine = (s) => String(s).replace(/\*\*/g, "").replace(/\n/g, " ");
const marked = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<em>$1</em>");
const handle = cfg.handle.replace("@", "");
const { accent, bg, card, line, muted } = cfg.colors;

const CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
:root{--bg:${bg};--card:${card};--line:${line};--muted:${muted};--accent:${accent};--fg:#EAEEF2}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--fg);font-family:Pretendard,sans-serif;word-break:keep-all;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
em{font-style:normal;color:var(--accent)}
.wrap{max-width:720px;margin:0 auto;padding:0 20px 120px}
.top{display:flex;align-items:center;justify-content:space-between;padding:18px 0;font-size:14px;color:var(--muted)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--fg);text-decoration:none}
.logo{width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900;font-size:15px}
.hero{position:relative;border-radius:24px;overflow:hidden;margin:6px 0 28px;aspect-ratio:4/3;background:#000}
.hero img{width:100%;height:100%;object-fit:cover;object-position:center 30%}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.85))}
.hero .badge{position:absolute;left:20px;bottom:18px;z-index:1;display:flex;gap:8px}
.chip{display:inline-block;font-size:13px;font-weight:700;padding:5px 11px;border-radius:999px;background:rgba(80,147,255,.16);color:var(--accent);border:1px solid rgba(80,147,255,.35)}
h1{font-size:32px;line-height:1.3;font-weight:900;letter-spacing:-.8px}
.meta{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0 26px;color:var(--muted);font-size:14px}
.meta b{color:var(--fg)}
.box{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:22px 22px}
.summary h3{font-size:13px;color:var(--accent);letter-spacing:1px;margin-bottom:8px}
.summary ul{padding-left:18px}
.summary li{margin:4px 0}
.toc{margin:16px 0 40px}
.toc h3{font-size:15px;margin-bottom:12px}
.toc ol{list-style:none;padding:0;counter-reset:t}
.toc li{counter-increment:t;display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:15px}
.toc li:first-child{border-top:0}
.toc li::before{content:counter(t);width:24px;height:24px;border-radius:50%;border:1.5px solid var(--muted);display:grid;place-items:center;font-size:12px;font-weight:700;flex:none}
.toc li.lock::after{content:"🔒";margin-left:auto;font-size:13px;opacity:.7}
h2{font-size:24px;font-weight:900;letter-spacing:-.5px;margin:48px 0 6px;scroll-margin-top:20px}
h2 small{display:block;font-size:13px;color:var(--accent);font-weight:800;letter-spacing:1px;margin-bottom:4px}
.lead{color:var(--muted);margin-bottom:18px}
.prompt{background:var(--card);border:1px solid var(--line);border-radius:18px;margin:14px 0;overflow:hidden}
.prompt header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line)}
.prompt header b{font-size:16px}
.prompt header b span{color:var(--accent);margin-right:8px;font-variant-numeric:tabular-nums}
.copy{font:inherit;font-size:13px;font-weight:700;color:#fff;background:var(--accent);border:0;border-radius:10px;padding:7px 12px;cursor:pointer}
.copy.done{background:#2a9d5c}
.prompt pre{margin:0;padding:16px 18px;white-space:pre-wrap;font-family:inherit;font-size:15px;color:#d6dce4}
.prompt .ok{padding:0 18px 16px;font-size:13px;color:var(--muted)}
.prompt .ok::before{content:"✓ ";color:var(--accent);font-weight:800}
table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}
th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:700;font-size:13px}
.faq details{border-top:1px solid var(--line);padding:14px 0}
.faq summary{font-weight:700;cursor:pointer}
.faq p{color:var(--muted);margin-top:8px}
.gate{position:relative}
.gate .blur{filter:blur(4px);opacity:.7;pointer-events:none;user-select:none;max-height:720px;overflow:hidden}
.gate .unlock{position:absolute;left:0;right:0;top:80px;margin:0 auto;max-width:440px}
.unlock h3{font-size:19px;margin-bottom:6px}
.unlock p{color:var(--muted);font-size:14px;margin-bottom:14px}
.unlock input[type=email]{width:100%;font:inherit;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:#0b0d12;color:var(--fg);margin-bottom:10px}
.unlock label{display:flex;gap:8px;font-size:13px;color:var(--muted);margin:6px 0;align-items:flex-start}
.unlock .btn{width:100%;margin-top:10px;font:inherit;font-weight:800;font-size:16px;padding:14px;border:0;border-radius:12px;background:var(--accent);color:#fff;cursor:pointer}
.unlock .notice{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.5}
.bar{position:fixed;left:0;right:0;bottom:0;background:rgba(15,15,15,.92);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
.bar .in{max-width:720px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px}
.bar a{background:var(--accent);color:#fff;text-decoration:none;font-weight:800;padding:9px 14px;border-radius:10px;white-space:nowrap}
.hub h1{margin-top:10px}
.search{width:100%;font:inherit;padding:13px 16px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--fg);margin:18px 0}
.item{display:flex;align-items:center;gap:14px;padding:12px;border-radius:16px;background:var(--card);border:1px solid var(--line);margin:10px 0;text-decoration:none}
.item img{width:64px;height:80px;border-radius:10px;object-fit:cover;flex:none;background:#000}
.item b{font-size:15px;line-height:1.45}
.item small{display:block;color:var(--muted);font-size:12px;margin-top:4px}
.item::after{content:"→";margin-left:auto;color:var(--accent);font-weight:800}
footer{margin-top:60px;color:var(--muted);font-size:12px}
footer a{color:var(--muted)}
@media (max-width:520px){h1{font-size:26px}h2{font-size:21px}}`;

const COPY_JS = `document.querySelectorAll('.copy').forEach(b=>b.onclick=async()=>{const t=b.closest('.prompt').querySelector('pre').innerText;try{await navigator.clipboard.writeText(t)}catch(e){const a=document.createElement('textarea');a.value=t;document.body.append(a);a.select();document.execCommand('copy');a.remove()}b.textContent='복사됨';b.classList.add('done');setTimeout(()=>{b.textContent='복사';b.classList.remove('done')},1500)});`;

// 이메일 잠금. 인증 없이 열어 주되, 법에 맞게 수집 목적·항목·보관 기간·거부 권리를 알리고 광고 수신은 따로 묻는다.
// cfg.email_endpoint 가 있으면 그 주소로 보내고, 없으면 이메일을 저장하지 않고 바로 열어 준다.
const GATE_JS = (endpoint) => `const g=document.querySelector('.gate');if(g){const k='unlocked:'+location.pathname;const open=()=>{g.querySelector('.blur').classList.remove('blur');g.querySelector('.unlock').remove()};try{if(localStorage.getItem(k))open()}catch(e){}
g.querySelector('form').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);${endpoint ? `try{await fetch(${JSON.stringify(endpoint)},{method:'POST',mode:'no-cors',body:JSON.stringify({email:f.get('email'),ad:!!f.get('ad'),page:location.pathname})})}catch(e){}` : ""}try{localStorage.setItem(k,'1')}catch(e){}open()}}`;

function page(title, body, { desc = "", scripts = "", image = "" } = {}) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(handle)}</title><meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:type" content="article">` : ""}
<style>${CSS}</style></head><body><div class="wrap">
<div class="top"><a class="brand" href="../index.html"><span class="logo">${esc(handle[0].toUpperCase())}</span>${esc(handle)}</a><span>자료 모음</span></div>
${body}
<footer><a href="../privacy.html">개인정보처리방침</a> · © ${new Date().getFullYear()} ${esc(handle)}</footer></div>
${scripts ? `<script>${scripts}</script>` : ""}</body></html>`;
}

const promptCard = (p) => `<div class="prompt"><header><b><span>${esc(p.num)}</span>${esc(p.name)}</b><button class="copy">복사</button></header>
<pre>${esc(p.text)}</pre>${p.success ? `<div class="ok">${esc(p.success)}</div>` : ""}</div>`;

const tableHtml = (t) => `<table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

function sectionHtml(s, i) {
  return `<h2 id="s${i}"><small>${esc(s.label ?? `PART ${i + 1}`)}</small>${esc(s.title)}</h2>
${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ""}
${(s.prompts ?? []).map(promptCard).join("")}
${s.table ? tableHtml(s.table) : ""}
${s.text ? `<div class="prompt"><header><b>${esc(s.text_name ?? "양식")}</b><button class="copy">복사</button></header><pre>${esc(s.text)}</pre></div>` : ""}`;
}

function guideHtml(g, imgRel) {
  let num = 0;
  const sections = g.sections.map((s) => ({ ...s, prompts: s.prompts?.map((p) => ({ ...p, num: String(++num).padStart(2, "0") })) }));
  const total = num;
  const minutes = g.minutes ?? Math.max(5, Math.round(total * 0.6));
  const free = g.free_sections ?? Math.ceil(sections.length / 2);
  const toc = [...sections.map((s) => s.title), ...(g.faq?.length ? ["자주 묻는 질문"] : [])];
  const openPart = sections.slice(0, free).map(sectionHtml).join("");
  const lockedPart = sections.slice(free).map((s, k) => sectionHtml(s, k + free)).join("") + faqHtml(g.faq);
  const gate = sections.length > free
    ? `<div class="gate"><div class="blur">${lockedPart}</div><div class="unlock box"><h3>나머지 ${sections.length - free}개 파트 열기</h3><p>이메일만 남기면 바로 열려요. 다음 자료가 나오면 먼저 알려드릴게요.</p>
<form><input type="email" name="email" placeholder="you@example.com" required>
<label><input type="checkbox" name="agree" required> (필수) 개인정보 수집·이용에 동의합니다.</label>
<label><input type="checkbox" name="ad"> (선택) 새 자료·소식 이메일 수신에 동의합니다.</label>
<button class="btn">무료로 전체 열기</button>
<div class="notice">수집 항목: 이메일 · 목적: 자료 열람 확인과 새 자료 안내(선택 동의 시) · 보관: 동의 철회 또는 수집 후 1년 중 빠른 날까지 · 동의를 거부할 수 있으며, 거부 시 잠긴 파트를 볼 수 없습니다. <a href="../privacy.html">개인정보처리방침</a></div></form></div></div>`
    : lockedPart;
  const body = `${imgRel ? `<div class="hero"><img src="${imgRel}" alt=""><div class="badge"><span class="chip">${esc(g.category ?? "프롬프트")}</span></div></div>` : ""}
<h1>${marked(g.title).replace(/\n/g, "<br>")}</h1>
<div class="meta"><span>읽는 데 <b>${minutes}분</b></span><span>프롬프트 <b>${total}개</b></span><span>파트 <b>${sections.length}개</b></span><span>${esc(g.date ?? "")} 공개</span></div>
<div class="box summary"><h3>SUMMARY</h3><ul>${g.summary.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
<div class="box toc"><h3>이 자료에 담긴 것</h3><ol>${toc.map((t, k) => `<li class="${k >= free ? "lock" : ""}">${esc(t)}</li>`).join("")}</ol></div>
${openPart}${gate}
<div class="bar"><div class="in"><span>매일 하나씩, 복사해서 쓰는 AI 업무 자료</span><a href="https://www.instagram.com/${esc(handle)}/">팔로우하기</a></div></div>`;
  return page(oneLine(g.title), body, { desc: g.summary[0], image: imgRel && cfg.guides_base ? cfg.guides_base + imgRel.replace("../", "") : "", scripts: COPY_JS + GATE_JS(cfg.email_endpoint) });
}

function faqHtml(faq) {
  if (!faq?.length) return "";
  return `<h2 id="faq"><small>FAQ</small>자주 묻는 질문</h2><div class="faq">${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>`;
}

function hubHtml(list) {
  const body = `<div class="hub"><span class="chip">자료 모음</span><h1>DM으로 못 받으셨다면<br><em>여기서 바로</em> 받아 가세요</h1>
<p class="lead" style="margin-top:12px">댓글이 몰리면 DM이 늦거나 빠질 수 있어요. 댓글 단 게시물의 표지를 찾아 눌러 주세요. 최신 자료가 맨 위에 있어요.</p>
<input class="search" placeholder="찾는 자료 검색 (예: 보고서, 엑셀, 메일)" oninput="const q=this.value.trim();document.querySelectorAll('.item').forEach(a=>a.style.display=a.textContent.includes(q)?'':'none')">
${list.map((g) => `<a class="item" href="g/${g.slug}.html">${g.thumb ? `<img src="${g.thumb}" alt="">` : ""}<span><b>${esc(oneLine(g.title))}</b><small>${esc(g.date ?? "")} · 프롬프트 ${g.count}개</small></span></a>`).join("")}</div>`;
  return page("DM으로 못 받으신 자료 모음", body, { desc: "댓글로 신청한 자료를 여기서 바로 받으세요" }).replaceAll('href="../', 'href="');
}

function privacyHtml() {
  const body = `<h1>개인정보처리방침</h1><div class="box" style="margin-top:20px">
<p>${esc(handle)}(이하 "운영자")는 자료 열람을 위해 아래와 같이 개인정보를 처리합니다.</p>
<h2 style="font-size:18px;margin-top:20px">1. 수집 항목과 목적</h2><p>이메일 주소. 잠긴 자료 열람 확인, 그리고 선택 동의한 경우에 한해 새 자료·소식 안내.</p>
<h2 style="font-size:18px">2. 보관 기간</h2><p>동의 철회 시 또는 수집일로부터 1년 중 빠른 날에 지체 없이 파기합니다.</p>
<h2 style="font-size:18px">3. 제3자 제공·위탁</h2><p>제3자에게 제공하지 않습니다. 저장에 쓰는 서비스가 있으면 이 페이지에 공개합니다.</p>
<h2 style="font-size:18px">4. 이용자의 권리</h2><p>언제든지 열람·정정·삭제·처리정지·동의 철회를 요청할 수 있습니다. 인스타그램 @${esc(handle)} DM${cfg.contact_email ? ` 또는 ${esc(cfg.contact_email)}` : ""}으로 요청하면 지체 없이 처리합니다.</p>
<h2 style="font-size:18px">5. 동의 거부</h2><p>동의를 거부할 수 있으며, 거부 시 잠긴 자료 일부를 볼 수 없습니다.</p>
<p style="margin-top:16px;color:var(--muted)">시행일: ${new Date().toISOString().slice(0, 10)}</p></div>`;
  return page("개인정보처리방침", body).replaceAll('href="../', 'href="');
}

// ---- 생성 ----
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "g"), { recursive: true });
fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
const guides = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"))) : [];
guides.sort((a, b) => String(b.date).localeCompare(String(a.date)));
const list = [];
for (const g of guides) {
  let imgRel = null;
  if (g.image && fs.existsSync(g.image)) {
    const name = `${g.slug}${path.extname(g.image)}`;
    fs.copyFileSync(g.image, path.join(OUT, "img", name));
    imgRel = `../img/${name}`;
  }
  fs.writeFileSync(path.join(OUT, "g", `${g.slug}.html`), guideHtml(g, imgRel));
  list.push({ ...g, thumb: imgRel?.replace("../", ""), count: g.sections.reduce((n, s) => n + (s.prompts?.length ?? 0), 0) });
}
fs.writeFileSync(path.join(OUT, "index.html"), hubHtml(list));
fs.writeFileSync(path.join(OUT, "privacy.html"), privacyHtml());
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`자료 ${guides.length}개 → ${OUT}/`);

if (process.argv.includes("--publish")) {
  const repo = process.env.SLIDES_GIT_DIR;
  if (!repo) throw new Error("SLIDES_GIT_DIR 가 없습니다");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "pipe" }).toString().trim();
  fs.cpSync(OUT, repo, { recursive: true });
  git("add", "-A", "index.html", "privacy.html", ".nojekyll", "g", "img");
  try { git("commit", "-m", "guides update"); git("push", "origin", "HEAD"); } catch { console.log("바뀐 자료가 없습니다"); }
  console.log("올림 완료");
}
