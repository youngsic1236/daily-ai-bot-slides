// 자동화 ①: 매일 자동 게시. 주제 선택 → Claude 원고 → Claude 검수 → 렌더링 → 업로드 → 게시.
// 사람이 손대지 않도록 검수에 두 번 떨어지면 그날은 게시하지 않고 기록만 남긴다.
// 사용법: node daily.mjs            (실제 게시)
//         node daily.mjs --dry-run  (게시 없이 이미지까지만)
//
// API 키 없이 쓰는 무료 방식 (Claude 앱의 예약 작업이 원고를 직접 쓴다)
//         node daily.mjs --brief              오늘 주제와 작성·검수 지시문을 JSON으로 출력
//         node daily.mjs --from 원고.json     작성된 원고로 렌더링 → 업로드 → 게시 (--dry-run 함께 가능)
//
// 원고에 guide(자료 페이지)나 guide_slug가 있으면: 자료 페이지를 사이트에 올리고, 마지막 장·캡션에 DM 안내를 넣고,
// 게시 후 그 게시물을 DM 발송 목록(공개 저장소 dm-campaigns.json)에 등록한다. 댓글이 달리면 dm.mjs가 링크를 보낸다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import {
  loadConfig, pickTopic, writeCarousel, reviewCarousel, renderSlides,
  uploadImages, publishCarousel, store, slugify, requireEnv,
  Carousel, trimCarousel, writeSystem, reviewSystem, nextQueuedTopic,
  DM_CTA, pickImage,
} from "./lib.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
const cfg = loadConfig();
const history = store("posted", []);
const posted = history.read();

if (args.includes("--brief")) {
  const topic = nextQueuedTopic(cfg, posted.map((p) => p.topic));
  console.log(JSON.stringify({
    topic: topic ?? null,
    topic_hint: topic ? null : `config.json 주제를 다 썼습니다. 계정 주제(${cfg.niche})에 맞고 이미 올린 주제와 겹치지 않는 새 주제를 정하세요.`,
    used_topics: posted.map((p) => p.topic).slice(-60),
    write_rules: writeSystem(cfg),
    review_rules: reviewSystem(cfg),
    format: "hook_title, hook_sub, slides[{headline, body}], cta_title, caption, hashtags[] (JSON)",
  }, null, 2));
  process.exit(0);
}

let topic, carousel;
if (from) {
  const parsed = Carousel.extend({ topic: z.string() }).safeParse(JSON.parse(fs.readFileSync(from, "utf8")));
  if (!parsed.success) {
    console.error(`원고 형식 오류:\n${parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    process.exit(1);
  }
  ({ topic } = parsed.data);
  carousel = trimCarousel(parsed.data);
} else {
  requireEnv("ANTHROPIC_API_KEY");
  topic = await pickTopic(cfg, posted.map((p) => p.topic));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const draft = await writeCarousel(topic, cfg);
    const review = await reviewCarousel(draft, cfg);
    if (review.ok) {
      carousel = draft;
      break;
    }
    console.log(`검수 불합격 (${attempt}/2):\n- ${review.problems.join("\n- ")}`);
  }
}
console.log(`주제: ${topic}`);

if (!carousel) {
  posted.push({ topic, skipped: true, at: new Date().toISOString() });
  history.write(posted);
  console.log("오늘은 게시하지 않습니다. 다음 실행 때 다른 주제로 넘어갑니다.");
  process.exit(0);
}

// ---- 자료 페이지 (DM으로 보낼 전체 자료) ----
const kstDate = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let guideSlug = carousel.guide_slug ?? null;
if (carousel.guide) {
  guideSlug = kstDate;
  for (let n = 2; fs.existsSync(path.join("guides", `${guideSlug}.json`)); n++) guideSlug = `${kstDate}-${n}`;
  // PC(윈도우)와 GitHub(리눅스) 어디서 다시 만들어도 찾도록 상대 경로로 저장
  const picked = pickImage("cover", carousel.hook_title, cfg.topic_scene?.[topic]);
  const image = picked ? path.relative(process.cwd(), picked).replaceAll("\\", "/") : null;
  fs.mkdirSync("guides", { recursive: true });
  fs.writeFileSync(path.join("guides", `${guideSlug}.json`), JSON.stringify({ slug: guideSlug, date: kstDate, image, ...carousel.guide }, null, 2));
}
let guide = null;
if (guideSlug) {
  guide = JSON.parse(fs.readFileSync(path.join("guides", `${guideSlug}.json`), "utf8"));
  const total = guide.sections.reduce((n, s) => n + (s.prompts?.length ?? 0), 0);
  carousel.dm_note = `댓글을 남겨주시면 **전체 ${total}개${guide.sections.some((s) => s.text || s.table) ? " + 양식" : ""}**을 DM으로 보내드려요`;
  carousel.cta_sub = DM_CTA;
  if (!carousel.caption.includes("DM")) carousel.caption += `\n${DM_CTA}`;
}

const slug = slugify(topic);
const dir = path.join("out", slug);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "carousel.json"), JSON.stringify(carousel, null, 2));
const files = await renderSlides(carousel, dir, cfg);
console.log(`렌더링: ${files.length}장 → ${dir}`);

// 자료 사이트를 다시 만든다. 실제 게시 때는 공개 저장소에 올려 링크가 먼저 살아 있게 한다.
if (guide) execFileSync(process.execPath, ["guides.mjs", ...(dry ? [] : ["--publish"])], { stdio: "inherit", env: process.env });

if (dry) {
  console.log(`dry-run: 업로드와 게시는 건너뜁니다.${guide ? ` 자료 페이지: site/g/${guideSlug}.html` : ""}`);
  process.exit(0);
}

// 인스타는 한글이 들어간 이미지 주소를 받아 가지 못하므로 업로드 경로는 영문·숫자로만 만든다.
const uploadPrefix = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[T:]/g, "-");
const urls = await uploadImages(files, uploadPrefix);
const caption = `${carousel.caption}\n\n${carousel.hashtags.join(" ")}`;
const mediaId = await publishCarousel(urls, caption);
posted.push({ topic, mediaId, guide: guideSlug, at: new Date().toISOString() });
history.write(posted);
console.log(`게시 완료: ${mediaId}`);

// DM 발송 목록에 등록: 이 게시물에 댓글이 달리면 dm.mjs(GitHub에서 5분마다)가 자료 링크를 보낸다.
if (guide) {
  const link = `${cfg.guides_base}g/${guideSlug}.html`;
  const entry = { title: guide.title.replace(/\*\*/g, "").replace(/\n/g, " "), link };
  const local = store("dm-campaigns", {});
  local.write({ ...local.read(), [mediaId]: entry });
  const repo = process.env.SLIDES_GIT_DIR;
  const file = path.join(repo, "dm-campaigns.json");
  const remote = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...remote, [mediaId]: entry }, null, 2));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "pipe" });
  git("add", "dm-campaigns.json");
  git("commit", "-m", `dm: ${mediaId}`);
  git("push", "origin", "HEAD");
  console.log(`DM 연결 완료: 댓글 → ${link}`);
}
