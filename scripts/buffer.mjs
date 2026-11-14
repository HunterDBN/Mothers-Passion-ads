#!/usr/bin/env node
// Schedules A Mother's Passion ads to Buffer (Facebook + TikTok).
//
// Commands:
//   node scripts/buffer.mjs discover            List the Buffer channels this token can post to.
//   node scripts/buffer.mjs schedule-day [date] Schedule the next 4 ads for a Vancouver date (default: today).
//
// Env:
//   BUFFER_ACCESS_TOKEN  required
//   IMAGE_BASE_URL       public base URL for ads/images (default: raw.githubusercontent.com on main)
//   DRY_RUN=1            print what would be scheduled without calling Buffer
//   CHANNEL_SERVICES     comma list of Buffer services to post to (default: facebook,tiktok)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TZ = "America/Vancouver";
// Peak phone-use times (Vancouver local): morning scroll, lunch, after work, evening wind-down.
const SLOTS = ["07:30", "12:15", "17:30", "20:30"];

const TOKEN = process.env.BUFFER_ACCESS_TOKEN || "";
const DRY = process.env.DRY_RUN === "1";
const SERVICES = (process.env.CHANNEL_SERVICES || "facebook,tiktok").split(",").map((s) => s.trim().toLowerCase());
const IMAGE_BASE =
  process.env.IMAGE_BASE_URL ||
  "https://raw.githubusercontent.com/HunterDBN/mothers-passion-ads/main/ads/images";

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const writeJson = (p, v) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 2) + "\n");

// ---------- time helpers ----------
function vancouverToUtc(dateStr, hhmm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = (tz) => new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz }));
  const offset = fmt("UTC") - fmt(TZ); // ms that Vancouver is behind UTC
  return new Date(guess + offset);
}
function vancouverToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

// ---------- Buffer API (GraphQL first, legacy v1 fallback) ----------
const GQL_ENDPOINTS = ["https://api.buffer.com", "https://api.buffer.com/graphql"];
let gqlEndpoint = null;

async function gql(query, variables = {}) {
  const tries = gqlEndpoint ? [gqlEndpoint] : GQL_ENDPOINTS;
  let lastErr;
  for (const url of tries) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ query, variables }),
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} non-JSON from ${url}: ${text.slice(0, 200)}`); }
      if (!res.ok && !body.data) throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(body).slice(0, 400)}`);
      gqlEndpoint = url;
      if (body.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors).slice(0, 800)}`);
      return body.data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function v1(method, pathname, form) {
  const url = new URL(`https://api.bufferapp.com/1/${pathname}`);
  url.searchParams.set("access_token", TOKEN);
  const init = { method };
  if (form) {
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    init.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`v1 ${pathname} HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

let apiMode = null; // "gql" | "v1"

async function listChannels() {
  try {
    const data = await gql(`query { account { organizations { id name } } }`);
    const orgs = data.account.organizations || [];
    const out = [];
    for (const org of orgs) {
      const d = await gql(
        `query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
        { input: { organizationId: org.id } },
      );
      for (const c of d.channels || []) out.push({ id: c.id, name: c.name, service: String(c.service).toLowerCase(), org: org.name });
    }
    apiMode = "gql";
    return out;
  } catch (e) {
    console.log(`GraphQL API unavailable (${e.message}). Trying legacy v1 API.`);
  }
  const profiles = await v1("GET", "profiles.json");
  apiMode = "v1";
  return profiles.map((p) => ({ id: p.id, name: p.formatted_username || p.service_username, service: String(p.service).toLowerCase() }));
}

async function createPost(channel, text, imageUrl, dueAt) {
  if (apiMode === "v1") {
    const form = {
      "profile_ids[]": channel.id,
      text,
      "media[photo]": imageUrl,
      "media[thumbnail]": imageUrl,
      scheduled_at: dueAt.toISOString(),
    };
    const r = await v1("POST", "updates/create.json", form);
    if (!r.success) throw new Error(`v1 create failed: ${JSON.stringify(r).slice(0, 400)}`);
    return r.updates?.[0]?.id;
  }
  const input = {
    text,
    channelId: channel.id,
    schedulingType: "automatic",
    needsApproval: false,
    mode: "customScheduled",
    dueAt: dueAt.toISOString(),
    assets: [{ image: { url: imageUrl } }],
  };
  if (channel.service === "facebook") input.metadata = { facebook: { type: "post" } };
  // TikTok photo posts reject the isAiGenerated flag, so only the title is sent.
  if (channel.service === "tiktok") input.metadata = { tiktok: { title: text.split("\n")[0].slice(0, 90) } };
  const d = await gql(
    `mutation Create($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }`,
    { input },
  );
  const r = d.createPost;
  if (r?.message) throw new Error(`createPost: ${r.message}`);
  return r?.post?.id;
}

// ---------- commands ----------
async function describeType(name) {
  try {
    const d = await gql(`query T($n: String!) { __type(name: $n) { name kind inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } }`, { n: name });
    const t = d.__type;
    if (!t) return console.log(`  type ${name}: not found`);
    const show = (ty) => (ty ? `${ty.kind === "NON_NULL" ? "!" : ty.kind === "LIST" ? "[]" : ""}${ty.name || ""}${ty.ofType ? show(ty.ofType) : ""}` : "");
    console.log(`  type ${name}: ${(t.inputFields || []).map((f) => `${f.name}:${show(f.type)}`).join(", ")}`);
  } catch (e) {
    console.log(`  type ${name}: introspection failed (${e.message.slice(0, 120)})`);
  }
}

async function discover() {
  const channels = await listChannels();
  console.log(`API mode: ${apiMode}${gqlEndpoint ? ` (${gqlEndpoint})` : ""}`);
  console.log(`Found ${channels.length} channel(s):`);
  for (const c of channels) console.log(`  - ${c.service}: ${c.name} [${c.id}]`);
  const targets = channels.filter((c) => SERVICES.includes(c.service));
  if (apiMode === "gql") {
    for (const n of ["CreatePostInput", "AssetInput", "AssetsInput", "ImageAssetInput", "PostInputMetaData", "FacebookPostMetadataInput", "TikTokPostMetadataInput"]) await describeType(n);
  }
  console.log(`Will post to: ${targets.map((c) => `${c.service}:${c.name}`).join(", ") || "NONE"}`);
}

async function scheduleDay(dateArg) {
  const date = dateArg || vancouverToday();
  const { ads, hashtags } = readJson("ads/ads.json");
  const state = readJson("ads/state.json");
  if (state.scheduled_days.includes(date)) {
    console.log(`${date} already scheduled; nothing to do.`);
    return;
  }
  const channels = DRY ? [] : (await listChannels()).filter((c) => SERVICES.includes(c.service));
  if (!DRY && channels.length === 0) throw new Error(`No ${SERVICES.join("/")} channels found in Buffer.`);

  const now = Date.now();
  let idx = state.next_index;
  let scheduled = 0;
  const failures = [];
  for (const slot of SLOTS) {
    const due = vancouverToUtc(date, slot);
    if (due.getTime() < now + 10 * 60 * 1000) {
      console.log(`Skip ${date} ${slot} (already passed)`);
      continue;
    }
    const ad = ads[idx % ads.length];
    idx += 1;
    const text = `${ad.caption}\n\n${hashtags} ${ad.tags || ""}`.trim();
    const imageUrl = `${IMAGE_BASE}/${ad.id}.jpg`;
    for (const ch of DRY ? [{ service: "dry-run", name: "-" }] : channels) {
      const label = `${date} ${slot} ${TZ} -> ${ch.service}:${ch.name} :: ${ad.id}`;
      if (DRY) { console.log(`[dry] ${label} (${due.toISOString()})`); continue; }
      try {
        const id = await createPost(ch, text, imageUrl, due);
        console.log(`Scheduled ${label} (post ${id})`);
        scheduled += 1;
      } catch (e) {
        console.log(`FAILED ${label}: ${e.message}`);
        failures.push(label);
      }
    }
  }
  if (!DRY && failures.length === 0) {
    state.next_index = idx % ads.length;
    state.scheduled_days = [...state.scheduled_days, date].slice(-60);
    writeJson("ads/state.json", state);
  }
  console.log(`Done: ${scheduled} post(s) scheduled, ${failures.length} failure(s).`);
  if (failures.length) process.exitCode = 1;
}

const [cmd, arg] = process.argv.slice(2);
if (!TOKEN && !DRY) { console.error("BUFFER_ACCESS_TOKEN is not set"); process.exit(1); }
if (cmd === "discover") await discover();
else if (cmd === "schedule-day") await scheduleDay(arg);
else { console.error("usage: buffer.mjs discover | schedule-day [YYYY-MM-DD]"); process.exit(2); }
