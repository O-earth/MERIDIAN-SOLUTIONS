(() => {
"use strict";
const CFG = Object.assign({adminId:"", passHash:"", repo:"", branch:"main", preview:false}, window.MNG_CONFIG || {});
const PREVIEW = !!CFG.preview; // 미리보기: GitHub 대신 이 브라우저에 저장
const DATA_PATH = "data/menagerie-data.js";
const TEAMS = {
  1:{name:"인외", en:"NON-HUMAN", code:"CLASS 01 · NON-HUMAN", c:"#7A5A9C"},
  2:{name:"개조인간", en:"AUGMENTED", code:"CLASS 02 · AUGMENTED", c:"#3E6BA3"},
  3:{name:"반인간", en:"DESIGNED", code:"CLASS 03 · DESIGNED", c:"#467D58"},
  4:{name:"인간", en:"BASELINE", code:"CLASS 04 · BASELINE", c:"#8A7B4E"}
};
const TEAM_KEYS = [1,2,3,4];
const STATUS = {
  ACTIVE:{ko:"현역", c:"#5E7A12"},
  DEPLOYED:{ko:"파견 중", c:"#3E6BA3"},
  "MEDICAL HOLD":{ko:"치료·정비 중", c:"#A9822A"},
  "CONTRACT SUSPENDED":{ko:"계약 정지", c:"#A9822A"},
  "MISSING IN ACTION":{ko:"작전 중 실종", c:"#A54848"},
  "KILLED IN ACTION":{ko:"전사", c:"#6E2A2A"},
  "RECORD MISMATCH":{ko:"기록불일치", c:"#3A4344"}
};
const LEVELS = [
  ["LOW","교전 가능성이 낮고 작전 지역이 통제되어 있습니다. 소수 인력의 경호·경비가 중심입니다."],
  ["GUARDED","산발적인 위협이 있습니다. 무장 오퍼레이터가 상시 대기합니다."],
  ["ELEVATED","교전이 예상됩니다. 분대 단위로 편성해 투입합니다."],
  ["HIGH","적대 세력의 통제 지역에 진입합니다. 강행 진입과 철수 계획이 함께 수립됩니다."],
  ["SEVERE","비표준 전력과의 교전이 예상되거나 생환 가능성을 보장할 수 없습니다. 개별 검토 후 수임합니다."]
];
const AXES = [
  ["화력","화기 운용과 제압"],
  ["근접","근접 전투·강행 진입"],
  ["내구","피격·부상 후 작전 지속"],
  ["규격 이탈","인간 규격을 벗어난 정도"],
  ["통제","팀장 지시·유지 약물 관리 순응도"],
  ["단독","팀 없이 작전 수행"]
];
const AXIS_DESC = Object.fromEntries(AXES);
const MAXV = 10, CAP = 15;

const S = {view:"home", team:"all", q:"", data:{settings:{}, agents:[], reports:[]}, plat:"all", sort:"new", loaded:false, admin:false, token:null, repo:null, sha:null, localImg:{}, editing:null, busy:false};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const has = v => v !== undefined && v !== null && String(v).trim() !== "";
const store = {
  get(k, ses){ try{ return (ses?sessionStorage:localStorage).getItem(k); }catch(e){ return null; } },
  set(k, v, ses){ try{ (ses?sessionStorage:localStorage).setItem(k, v); }catch(e){} },
  del(k, ses){ try{ (ses?sessionStorage:localStorage).removeItem(k); }catch(e){} }
};

const sha256 = str => window.MNG_hash(str);

/* ============ repo / GitHub API ============ */
function resolveRepo(){
  if(CFG.repo) return CFG.repo.trim();
  const h = location.hostname;
  if(h.endsWith(".github.io")){
    const owner = h.split(".")[0];
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return owner + "/" + (seg && !seg.includes(".") ? seg : h);
  }
  return "";
}
S.repo = resolveRepo();
const b64enc = str => { const bytes = new TextEncoder().encode(str); let bin = ""; for(let i=0;i<bytes.length;i+=0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000)); return btoa(bin); };
const b64dec = b64 => { const bin = atob(b64.replace(/\n/g,"")); const bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
async function gh(method, path, body){
  const url = `https://api.github.com/repos/${S.repo}${path}`;
  const res = await fetch(url, {method, headers:{"Accept":"application/vnd.github+json","Authorization":`Bearer ${S.token}`,"X-GitHub-Api-Version":"2022-11-28", ...(body?{"Content-Type":"application/json"}:{})}, body: body ? JSON.stringify(body) : undefined, cache:"no-store"});
  if(res.status === 404 && method === "GET") return null;
  const json = res.status === 204 ? {} : await res.json().catch(()=>({}));
  if(!res.ok){ const e = new Error(json.message || res.statusText); e.status = res.status; throw e; }
  return json;
}
const contentsPath = p => `/contents/${p.split("/").map(encodeURIComponent).join("/")}`;
async function ghGetFile(p){ return gh("GET", `${contentsPath(p)}?ref=${encodeURIComponent(CFG.branch)}&t=${Date.now()}`); }
async function ghPutFile(p, b64, message, sha){ return gh("PUT", contentsPath(p), {message, content:b64, branch:CFG.branch, ...(sha?{sha}:{})}); }
async function ghDeleteFile(p, message){
  if(PREVIEW) return;
  try{ const f = await ghGetFile(p); if(!f) return; await gh("DELETE", contentsPath(p), {message, sha:f.sha, branch:CFG.branch}); }catch(e){ /* 이미 없거나 실패: 무시 */ }
}
function parseDataFile(text){
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  const d = JSON.parse(text.slice(s, e+1));
  return {settings:d.settings||{}, agents:Array.isArray(d.agents)?d.agents:[], reports:Array.isArray(d.reports)?d.reports:[]};
}
function serialize(d){
  return `/* MENAGERIE 사이트 데이터. 관리자 화면에서 저장하면 자동으로 갱신됩니다. 직접 고칠 때는 JSON 문법을 지켜 주세요. */\nwindow.MNG_DATA = ${JSON.stringify({settings:d.settings, agents:d.agents, reports:d.reports||[]}, null, 2)};\n`;
}
async function pullRemote(){
  if(PREVIEW){ const t = store.get("mng-preview-data"); if(t){ try{ S.data = parseDataFile(t); }catch(e){} } S.loaded = true; renderAll(); return; }
  const f = await ghGetFile(DATA_PATH);
  if(f){ S.sha = f.sha; S.data = parseDataFile(b64dec(f.content)); }
  else { S.sha = null; }
  S.loaded = true; renderAll();
}
async function commitData(message){
  const text = serialize(S.data);
  if(PREVIEW){ try{ localStorage.setItem("mng-preview-data", text); }catch(e){ toast("브라우저 저장 공간이 부족해 새로고침하면 사라질 수 있습니다. 사진 수를 줄여 주세요."); } return; }
  try{
    const r = await ghPutFile(DATA_PATH, b64enc(text), message, S.sha);
    S.sha = r.content.sha;
  }catch(e){
    if(e.status === 409 || e.status === 422){ // sha 어긋남 → 최신 sha로 한 번 더
      const f = await ghGetFile(DATA_PATH); const r = await ghPutFile(DATA_PATH, b64enc(text), message, f && f.sha); S.sha = r.content.sha;
    } else throw e;
  }
}
async function uploadImage(dataUrl, path, message){
  if(PREVIEW) return dataUrl;
  await ghPutFile(path, dataUrl.split(",")[1], message);
  S.localImg[path] = dataUrl;
  return path;
}
const imgSrc = p => !p ? "" : (S.localImg[p] || p);
function ghError(e){
  if(!e) return "저장하지 못했습니다.";
  if(e.status === 401) return "GitHub 토큰이 만료되었거나 올바르지 않습니다. 로그아웃 후 토큰을 다시 연결해 주세요.";
  if(e.status === 403) return "이 토큰에는 저장소 쓰기 권한이 없습니다. Contents: Read and write 권한을 확인해 주세요.";
  if(e.status === 404) return "저장소를 찾을 수 없습니다. config.js의 repo 값을 확인해 주세요.";
  if(e.message && /Failed to fetch|NetworkError/i.test(e.message)) return "GitHub에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  return "저장하지 못했습니다: " + (e.message || "알 수 없는 오류");
}
function setSync(text, warn){ $("syncText").textContent = text; $("sync").classList.toggle("warn", !!warn); }

/* ============ public data load ============ */
function loadPublic(){
  const s = document.createElement("script");
  s.src = PREVIEW ? DATA_PATH : `${DATA_PATH}?t=${Date.now()}`;
  s.onload = ()=>{ if(PREVIEW){ const t = store.get("mng-preview-data"); if(t){ try{ S.data = parseDataFile(t); S.loaded = true; renderAll(); return; }catch(e){} } }
    if(!S.admin || !S.token){ const d = window.MNG_DATA || {}; S.data = {settings:d.settings||{}, agents:Array.isArray(d.agents)?d.agents:[], reports:Array.isArray(d.reports)?d.reports:[]}; S.loaded = true; renderAll(); } };
  s.onerror = ()=>{ S.loaded = true; renderAll(); };
  document.head.appendChild(s);
}

/* ============ static ============ */
$("levels").innerHTML = LEVELS.map(([k,d],i)=>`<div class="lv ${i===4?"max":""}"><span class="pips">${[0,1,2,3,4].map(j=>`<i class="${j<=i?"on":""}"></i>`).join("")}</span><b>LEVEL ${i+1} · ${k}</b><span>${d}</span></div>`).join("");
function tick(){ try{ $("hqTime").textContent = new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:false,timeZoneName:"short"}).format(new Date()); }catch(e){} }
tick(); setInterval(tick, 20000);

/* ============ navigation ============ */
function go(view, sec, push=true){
  S.view = view;
  const VIEWS = {home:"viewHome", roster:"viewRoster", board:"viewBoard", recruit:"viewRecruit"};
  Object.entries(VIEWS).forEach(([k,id])=>{ $(id).hidden = view !== k; });
  document.querySelectorAll("nav.main button").forEach(b=>{
    const on = view!=="home" ? b.dataset.go===view : (b.dataset.go==="home" && b.dataset.sec===(sec||"about"));
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  if(push){ try{ history.replaceState(null, "", view!=="home" ? "#"+view : (sec ? "#"+sec : location.pathname)); }catch(e){} }
  if(view==="home" && sec){
    requestAnimationFrame(()=>{ const el = $("sec-"+sec); if(el){ const y = el.getBoundingClientRect().top + window.scrollY - 50; window.scrollTo({top:y,behavior:"smooth"}); } });
  } else window.scrollTo({top:0});
  if(view==="roster") renderRoster();
  if(view==="board") renderBoard();
}
document.addEventListener("click", e=>{
  const g = e.target.closest("[data-go]"); if(g){ e.preventDefault(); go(g.dataset.go, g.dataset.sec); return; }
  const c = e.target.closest("[data-close]"); if(c){ closeModal(c.dataset.close); return; }
  const t = e.target.closest("[data-team]"); if(t){ S.team = t.dataset.team; go("roster"); }
});

/* ============ helpers ============ */
const agents = () => S.data.agents;
const isAsset = a => a.kind === "asset";
const people = () => agents().filter(a => !isAsset(a));
const counted = () => people().filter(a => !a.teaser);
const assets = () => agents().filter(isAsset);
const assetNoOf = a => a.assetNo || "EQ-????";
const teamOf = a => a._unit ? a._unit : (TEAMS[a.team] || TEAMS[1]);
const isNew = a => a.createdAt && (Date.now() - a.createdAt) < 14*864e5;
const isMismatch = a => statusOf(a) === "RECORD MISMATCH";
function ghostNo(a){ const m = /(\d+)\s*$/.exec(a.no||""); const n = m ? +m[1] : 0; const alt = (n + 1 + hash32(a.id||a.no) % 89) % 1000; return (a.no||"MNG-").replace(/\d+\s*$/,"") + String(alt).padStart(3,"0"); }
const statusOf = a => "ACTIVE";
function hash32(str){ let h=2166136261; for(const ch of String(str)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619);} return h>>>0; }
function barcode(seed){
  let h = hash32(seed), x = 0, st = [];
  while(x < 100){ const w = .6 + (h % 5) * .55; h = Math.imul(h ^ (h>>>13), 1597334677)>>>0; const g = .6 + (h % 4) * .6; h = Math.imul(h ^ (h>>>11), 2654435761)>>>0;
    st.push(`#D9D8CC ${x.toFixed(2)}% ${(x+w).toFixed(2)}%`, `transparent ${(x+w).toFixed(2)}% ${(x+w+g).toFixed(2)}%`); x += w + g; }
  return `linear-gradient(90deg,${st.join(",")})`;
}
function safeUrl(u){ try{ const x = new URL(String(u).trim()); return (x.protocol==="https:"||x.protocol==="http:") ? x.href : null; }catch(e){ return null; } }
function guessPlatform(u){
  const h = (()=>{ try{ return new URL(u).hostname.toLowerCase(); }catch(e){ return ""; } })();
  if(h.includes("caveduck")) return "케이브덕";
  if(h.includes("unichat")) return "유니챗";
  if(h.includes("teapot") || h.includes("tpot")) return "티팟";
  return h.replace(/^www\./,"");
}
const linksOf = a => (a.links||[]).map(l=>({label:l.label||guessPlatform(l.url), url:safeUrl(l.url)})).filter(l=>l.url);
function nameHTML(a, big){
  if(isMismatch(a) && !S.admin && !big) return `<span class="glitch">기록 대조 실패</span>`;
  if(!a.name) return big ? `<span style="color:var(--faint)">미기재</span>` : "&nbsp;";
  if(a.nameHidden && !S.admin) return `<span class="redact">${esc(a.name)}</span>`;
  return esc(a.name) + (a.nameHidden ? ` <span style="font-size:10.5px;color:var(--faint)">[비공개]</span>` : "");
}
function photoHTML(a){
  const st = statusOf(a), sc = STATUS[st].c, src = imgSrc(a.photo);
  const pos = `object-position:center ${esc(a.photoPos||"30%")}`;
  let img = src ? `<img src="${esc(src)}" alt="${esc(a.callsign)}" loading="lazy" style="${pos}">` : `<span class="ph">${esc((a.callsign||"?").trim().slice(0,2).toUpperCase())}</span>`;
  if(src && st==="RECORD MISMATCH") img += `<img class="ghost" src="${esc(src)}" alt="" aria-hidden="true" style="${pos}">`;
  const stamp = st!=="ACTIVE" ? `<span class="stamp" style="--sc:${sc}">${esc(st)}</span>` : "";
  return `<span class="photo">${img}${stamp}</span>`;
}
const isTeaser = a => !!a.teaser && !S.admin;
function teaserBadgeHTML(a, interactive){
  const src = imgSrc(a.photo);
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" style="object-position:center ${esc(a.photoPos||"30%")}">` : `<span class="ph">?</span>`;
  const inner = `<span class="slot"></span>
    <span class="band"><span class="lg"></span><span class="bt"><b>ARMED CONTRACTOR</b><small>CLASSIFIED</small></span></span>
    <span class="hz"></span>
    <span class="bbody"><span class="photo">${img}</span>
      <span class="tz"><b>INCOMING</b><small>등록 전</small></span>
      <span class="dgrid g3"><span><small>CLASS</small><b><i class="rbar" style="width:80%"></i></b></span><span><small>BIRTH</small><b><i class="rbar" style="width:70%"></i></b></span><span><small>ARMED</small><b><i class="rbar" style="width:75%"></i></b></span></span></span>`;
  const body = interactive ? `<button class="hit" data-open="${esc(a.id)}" aria-label="추후 공개 오퍼레이터">${inner}</button>` : inner;
  return `<div class="badge teaser" style="--tc:#E4F020;--bc:${barcode(a.id||"x")}">${body}<span class="bfoot"><span class="barcode"></span></span><span class="prop">PROPERTY OF MERIDIAN SOLUTIONS · IF FOUND CALL CONTRACT DESK</span></div>`;
}
function badgeHTML(a, interactive=true){
  if(isTeaser(a)) return teaserBadgeHTML(a, interactive);
  const t = teamOf(a), st = statusOf(a), sc = STATUS[st].c, links = linksOf(a);
  const cell = (k,v,c) => `<span><small>${k}</small><b${c?` style="color:${c}"`:""}>${v}</b></span>`;
  const inner = `<span class="slot"></span>
    <span class="band"><span class="lg"></span><span class="bt"><b>${isAsset(a)?"EQUIPMENT ASSET":"ARMED CONTRACTOR"}</b><small>${isAsset(a)?esc(assetNoOf(a))+" · "+t.en:t.code}</small></span></span>
    <span class="hz"></span>${interactive && a.teaser ? `<span class="newtag tzt">등록 전</span>` : interactive && isNew(a) ? `<span class="newtag">NEW</span>` : ""}
    <span class="bbody">
      ${photoHTML(a)}
      <span><span class="cs">${esc(a.callsign||"UNNAMED")}</span><span class="nm">${nameHTML(a)}</span></span>
      <span class="dgrid g3">
        ${cell("CLASS", esc(t.name))}
        ${cell("BIRTH", esc(a.birthday||"—"))}
        ${cell("ARMED", esc(a.weapon||"—"))}
      </span>
      ${has(a.medAlert) ? `<span class="med"><b>MED ALERT</b>${esc(a.medAlert)}</span>` : ""}
    </span>`;
  let lnk = "";
  if(interactive && links.length===1) lnk = `<a class="lnk" href="${esc(links[0].url)}" target="_blank" rel="noopener" title="${esc(links[0].label)}에서 열기">${esc(links[0].label.slice(0,8))} ↗</a>`;
  else if(interactive && links.length>1) lnk = `<button class="lnk" data-open="${esc(a.id)}" data-scroll="access">LINK ${links.length}</button>`;
  else if(!interactive && links.length) lnk = `<span class="lnk">LINK ${links.length}</span>`;
  const body = interactive ? `<button class="hit" data-open="${esc(a.id)}" aria-label="${esc(a.callsign)} 인사기록 보기">${inner}</button>` : inner;
  return `<div class="badge ${st!=="ACTIVE"?"inactive":""} ${isMismatch(a)?"mismatch":""}" style="--tc:${t.c};--bc:${barcode(a.id||a.callsign)}">${body}<span class="bfoot"><span class="barcode"></span>${lnk}</span><span class="prop">PROPERTY OF MERIDIAN SOLUTIONS · IF FOUND CALL CONTRACT DESK</span></div>`;
}

/* ============ radar ============ */
function statsOf(a){ return (a.stats||[]).filter(s=>s && has(s.k)).map(s=>({k:String(s.k), v:Math.max(0, Math.min(CAP, Number(s.v)||0))})); }
function radarSVG(stats, color){
  const n = stats.length; if(n < 3) return "";
  const R = 100, ang = i => -Math.PI/2 + i*2*Math.PI/n;
  const pt = (i, r) => [Math.cos(ang(i))*r, Math.sin(ang(i))*r];
  const ring = r => stats.map((_,i)=>pt(i,r).map(v=>v.toFixed(1)).join(",")).join(" ");
  let g = "";
  for(let k=2;k<=10;k+=2) g += `<polygon points="${ring(R*k/10)}" fill="none" stroke="${k===10?"rgba(230,229,220,.5)":"rgba(230,229,220,.14)"}" stroke-width="${k===10?1.2:.8}"/>`;
  stats.forEach((_,i)=>{ const [x,y] = pt(i,R); g += `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(230,229,220,.14)" stroke-width=".8"/>`; });
  const poly = stats.map((s,i)=>pt(i, R*s.v/MAXV).map(v=>v.toFixed(1)).join(",")).join(" ");
  g += `<polygon points="${poly}" fill="${color}" fill-opacity=".2" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`;
  stats.forEach((s,i)=>{ const [x,y] = pt(i, R*s.v/MAXV); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${s.v>MAXV?"#E5533F":color}"/>`; });
  stats.forEach((s,i)=>{
    const over = s.v > MAXV, r = Math.max(R+18, R*s.v/MAXV + 16);
    const [x,y] = pt(i, r), c = Math.cos(ang(i)), sn = Math.sin(ang(i));
    const anchor = Math.abs(c) < .3 ? "middle" : (c > 0 ? "start" : "end");
    const dy = sn > .5 ? 12 : (sn < -.5 ? -3 : 4);
    g += `<text x="${x.toFixed(1)}" y="${(y+dy).toFixed(1)}" text-anchor="${anchor}" font-size="13" font-weight="${over?800:600}" fill="${over?"#E5533F":"#E6E5DC"}" font-family="Pretendard Variable,Pretendard,system-ui,sans-serif">${esc(s.k)}</text>`;
  });
  const ext = Math.max(R, ...stats.map(s=>R*s.v/MAXV)) + 46, pad = ext + 34;
  return `<svg viewBox="${-pad} ${-ext} ${pad*2} ${ext*2}" role="img" aria-label="능력 평가: ${stats.map(s=>esc(s.k)+" "+s.v).join(", ")}">${g}</svg>`;
}
function scoresHTML(stats){
  return `<div class="scores">${stats.map(s=>{ const over = s.v>MAXV, d = AXIS_DESC[s.k];
    return `<div><span>${esc(s.k)}${d?`<small>${esc(d)}</small>`:""}</span><span class="meter"><i class="${over?"over":""}" style="width:${Math.min(100,s.v/MAXV*100)}%"></i></span><b class="${over?"over":""}">${s.v}</b></div>`; }).join("")}</div>`;
}

/* ============ home ============ */
function renderTiles(){
  const n = k => counted().filter(a=>String(a.team)===String(k)).length;
  $("teamTiles").innerHTML = TEAM_KEYS.map(k=>{ const t = TEAMS[k];
    return `<button class="tt" data-team="${k}" style="--tc:${t.c}"><small><i></i>${t.code}</small><b>${t.name}</b><span class="cnt"><span>등재 인원</span><strong class="num">${S.loaded?n(k):"–"}</strong></span></button>`; }).join("");
  $("heroCount").textContent = S.loaded ? `오퍼레이터 ${counted().length}명 등재` : "—";
}
function renderHero(){
  const fig = $("heroFig"), hero = imgSrc(S.data.settings.hero);
  const btn = S.admin && S.token ? `<button class="btn inv sm set-img" id="setHero">${hero?"메인 이미지 변경":"메인 이미지 등록"}</button>` : "";
  if(hero) fig.innerHTML = `${btn}<img src="${esc(hero)}" alt="Meridian Solutions"><figcaption class="cap"><span>FIELD ARCHIVE · MERIDIAN SOLUTIONS</span><span>PHOTO © MERIDIAN SOLUTIONS</span></figcaption>`;
  else if(btn) fig.innerHTML = `${btn}<div class="empty">메인 이미지가 아직 없습니다. 오른쪽 위 버튼으로 등록하면 이 자리에 표시됩니다.</div>`;
  else fig.innerHTML = "";
  const b = $("setHero"); if(b) b.onclick = ()=> $("heroFile").click();
}
$("heroFile").addEventListener("change", async e=>{
  const f = e.target.files[0]; e.target.value = ""; if(!f || !S.token) return;
  try{
    toast("이미지를 올리는 중입니다…");
    const data = await compress(f, 2000, 900000);
    const path = `assets/hero-${Date.now()}.jpg`, old = S.data.settings.hero;
    S.data.settings.hero = await uploadImage(data, path, "메인 이미지 변경");
    await commitData("메인 이미지 변경");
    if(old && old.startsWith("assets/")) ghDeleteFile(old, "이전 메인 이미지 삭제");
    renderHero(); toast("메인 이미지를 저장했습니다. 공개 사이트에는 1~2분 뒤 반영됩니다.");
  }catch(err){ toast(ghError(err)); }
});

/* ============ roster ============ */
function renderTabs(){
  const cnt = k => k==="all" ? counted().length : counted().filter(a=>String(a.team)===k).length;
  const items = [["all","전체",""], ...TEAM_KEYS.map(k=>[String(k), TEAMS[k].name+" "+TEAMS[k].en, TEAMS[k].c])];
  $("tabs").innerHTML = items.map(([k,l,c])=>`<button role="tab" aria-selected="${S.team===k}" data-tab="${k}" ${c?`style="--tc:${c}"`:""}><span class="dot"></span>${l}<span class="c num">${S.loaded?cnt(k):"–"}</span></button>`).join("");
}
$("tabs").addEventListener("click", e=>{ const b = e.target.closest("[data-tab]"); if(b){ S.team = b.dataset.tab; renderRoster(); } });
$("q").addEventListener("input", e=>{ S.q = e.target.value.trim().toLowerCase(); renderRoster(); });
$("platChips").addEventListener("click", e=>{ const b = e.target.closest("[data-plat]"); if(b){ S.plat = b.dataset.plat; renderRoster(); } });
$("sortSel").addEventListener("change", e=>{ S.sort = e.target.value; renderRoster(); });
function renderRoster(){
  renderTabs();
  $("teamNote").textContent = S.team==="all" ? "분류는 신체 특성에 따른 구분이며, 업무·권한·보수 기준에는 차이가 없습니다." : `${TEAMS[S.team].name} · ${TEAMS[S.team].en}`;
  let list = people().filter(a => S.team==="all" || (!isTeaser(a) && String(a.team)===S.team));
  if(S.plat!=="all") list = list.filter(a => linksOf(a).some(l=>l.label===S.plat));
  list = [...list].sort(S.sort==="new" ? (a,b)=>(b.createdAt||0)-(a.createdAt||0) : (a,b)=>String(a.no||"").localeCompare(String(b.no||""), undefined, {numeric:true}));
  document.querySelectorAll("#platChips button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.plat===S.plat)));
  if(S.q) list = list.filter(a => !isTeaser(a) && (a.callsign||"").toLowerCase().includes(S.q) || (S.admin && (a.name||"").toLowerCase().includes(S.q)));
  $("rCount").textContent = S.loaded ? `${list.length} / ${people().length}명` : "";
  const canEdit = S.admin && S.token;
  const add = canEdit ? `<button class="add-badge" id="addAgent"><span class="plus">+</span>오퍼레이터 등록<small>NEW OPERATOR CARD</small></button>` : "";
  let html;
  if(!S.loaded) html = `<div class="empty-reg"><b>명부를 불러오는 중입니다</b></div>`;
  else if(!list.length){
    const msg = S.q ? "검색 결과가 없습니다." : (canEdit ? "아직 등재된 오퍼레이터가 없습니다. 옆의 카드로 첫 오퍼레이터를 등록하세요." : "현재 공개된 오퍼레이터가 없습니다.");
    html = `<div class="empty-reg" ${canEdit&&!S.q?'style="grid-column:auto / span 2"':""}><b>등재된 오퍼레이터 없음</b><p>${msg}</p></div>`;
  } else html = list.map(a=>badgeHTML(a)).join("");
  $("badges").innerHTML = html + (S.loaded ? add : "");
  const ab = $("addAgent"); if(ab) ab.onclick = ()=> openEditor(null);
  renderAssets();
}
function renderAssets(){
  const canEdit = S.admin && S.token, list = [...assets()].sort((a,b)=>String(a.assetNo||"").localeCompare(String(b.assetNo||""), undefined, {numeric:true}));
  $("assetAdd").hidden = !canEdit;
  $("assetCount").textContent = S.loaded ? `${list.length}건` : "";
  if(!S.loaded){ $("assetRows").innerHTML = ""; return; }
  if(!list.length){ $("assetRows").innerHTML = `<div class="as-empty">등록된 자산이 없습니다.</div>`; return; }
  $("assetRows").innerHTML = list.map(a=>{
    const t = teamOf(a), src = imgSrc(a.photo), tz = isTeaser(a);
    const th = src ? `<img src="${esc(src)}" alt="" loading="lazy" style="object-position:center ${esc(a.photoPos||"30%")}">` : `<span>${tz?"?":esc((a.callsign||"?").slice(0,2).toUpperCase())}</span>`;
    const cell = v => tz ? `<i class="rbar" style="width:70%"></i>` : esc(v||"—");
    return `<button class="as-row" data-open="${esc(a.id)}"><span class="as-th">${th}</span><span class="as-no num">${tz?"EQ-████":esc(assetNoOf(a))}</span><span class="as-nm"><b>${tz?"CLASSIFIED":esc(a.callsign||"—")}</b>${!tz && a.teaser ? ' <em class="as-tz">등록 전</em>' : ""}</span><span>${tz?cell(""):esc(t.name)}</span><span>${cell(a.acquisition)}</span><span class="as-st">${cell(a.assetStatus||"운용 중")}</span></button>`;
  }).join("");
}
$("assetRows").addEventListener("click", e=>{ const b = e.target.closest("[data-open]"); if(b){ e.preventDefault(); openFile(b.dataset.open); } });
$("assetAdd").onclick = ()=> openEditor(null, "asset");
$("badges").addEventListener("click", e=>{ const b = e.target.closest("[data-open]"); if(b){ e.preventDefault(); openFile(b.dataset.open, b.dataset.scroll); } });
function renderAll(){ renderTiles(); renderHero(); renderRoster(); if(S.view==="board") renderBoard(); }

/* ============ personnel file ============ */
function openFile(id, scrollTo){
  const a = agents().find(x=>x.id===id); if(!a) return;
  if(isTeaser(a)){
    const src = imgSrc(a.photo), m = $("fileModal"); m.style.setProperty("--tc", "#E4F020");
    m.innerHTML = `<button class="x" data-close="fileScrim" aria-label="닫기">×</button>
      <div class="m-head"><span>MERIDIAN SOLUTIONS · 인사기록 · PERSONNEL FILE</span><span>CLASSIFIED</span></div>
      <div class="teaser-file">${src ? `<img src="${esc(src)}" alt="">` : ""}<div class="tz-cap"><b>INCOMING</b><span>등록 전인 오퍼레이터입니다. 기록은 등록 후 공개됩니다.</span></div></div>`;
    openModal("fileScrim"); return;
  }
  const t = teamOf(a), st = statusOf(a), links = linksOf(a), stats = statsOf(a);
  const kw = String(a.keywords||"").split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const kv = [...(isAsset(a) ? [["자산 번호", assetNoOf(a)],["취득 경위", a.acquisition],["자산 상태", a.assetStatus||"운용 중"]] : []),[isAsset(a)?"식별명":"실명", null, nameHTML(a,true)],["나이", a.age],["생일", a.birthday],["키", a.height],["의무 경고", a.medAlert],["비상연락처", a.kin],["분류", `${t.name} (${t.en})`],["주무기", a.weapon],
    ...(a.fields||[]).filter(f=>f && (has(f.k)||has(f.v))).map(f=>[f.k||"—", f.v])].filter(f=>f[2] || has(f[1]));
  const hasNums = [a.cases,a.highrisk,a.discipline].some(has);
  const trait = (h, v) => has(v) ? `<div class="trait"><h4 class="sec-h">${h}</h4><p>${esc(v)}</p></div>` : "";
  const canEdit = S.admin && S.token;
  const m = $("fileModal"); m.style.setProperty("--tc", t.c);
  m.innerHTML = `<button class="x" data-close="fileScrim" aria-label="닫기">×</button>
    <div class="m-head"><span>${isAsset(a) ? "MERIDIAN SOLUTIONS · 자산 기록 · ASSET RECORD" : "MERIDIAN SOLUTIONS · 인사기록 · PERSONNEL FILE"}</span><span>${isAsset(a) ? esc(assetNoOf(a)) : esc(t.code)}</span></div>
    ${isMismatch(a) ? `<div class="mm-note"><b>RECORD MISMATCH · 기록 불일치</b>이 인사기록은 현실의 인물과 일치하지 않습니다. 일부 항목은 대조에 실패했으며, 열람 내용은 참고용으로만 사용하십시오.</div>` : ""}
    <div class="file ${isMismatch(a)?"mm":""}">
      <div class="left">
        <div class="pf-photo" style="--tc:${t.c}">${imgSrc(a.photo) ? `<img src="${esc(imgSrc(a.photo))}" alt="${esc(a.callsign)}" style="object-position:center ${esc(a.photoPos||"30%")}">` : `<span>${esc((a.callsign||"?").slice(0,2).toUpperCase())}</span>`}<i class="pf-tag">${isAsset(a) ? esc(assetNoOf(a)) : esc(t.code)}</i></div>
        <button class="btn sm" id="savePng" style="width:100%;margin-top:10px">ID 카드 이미지 저장</button>
        <div class="access" id="access"><h4 class="sec-h">바로가기 · ACCESS</h4>
          ${links.length ? `<div class="list">${links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener"><span>${esc(l.label)}</span><span aria-hidden="true">↗</span></a>`).join("")}</div>` : `<div class="none">연결된 링크가 없습니다.</div>`}
        </div>
      </div>
      <div style="min-width:0">
        <h2>${esc(a.callsign||"UNNAMED")}</h2>
        <div class="sub"><span>${t.name}</span>${has(a.weapon)?`<span>${esc(a.weapon)}</span>`:""}</div>
        ${has(a.quote) ? `<div class="quote">${esc(a.quote)}</div>` : ""}
        ${kw.length ? `<div class="kw">${kw.map(k=>`<span>${esc(k)}</span>`).join("")}</div>` : ""}
        <dl class="kv">${kv.map(([k,v,h])=>`<dt>${esc(k)}</dt><dd>${h ?? esc(v)}${isMismatch(a) && ["실명","나이","생일","키"].includes(k) ? ` <span class="mmflag">대조 실패</span>` : ""}</dd>`).join("")}</dl>
        ${stats.length>=3 ? `<div class="eval">${radarSVG(stats, t.c)}<div><h4 class="sec-h">능력 평가 · ASSESSMENT</h4><div style="margin-top:8px">${scoresHTML(stats)}</div><div style="font-size:11.5px;color:var(--faint);margin-top:8px">기준 10. 붉은 값은 규격 외 판정.</div></div></div>` : ""}
        ${hasNums ? `<div class="stats3"><div><small>파견 횟수</small><strong>${esc(a.cases||0)}</strong>회</div><div><small>팀장 지휘</small><strong>${esc(a.highrisk||0)}</strong>회</div><div><small>지휘 자격</small><strong style="font-size:17px;font-weight:600">${esc(a.discipline||"없음")}</strong></div></div>` : ""}
        ${trait("전투 방식 · COMBAT", a.combat)}
        ${trait("거점 평판 · ON BASE", a.reputation)}
        ${trait("개조·신체 특이사항 · BODY", a.remarks)}
        ${trait("트레일러 · QUARTERS", a.trailer)}
        ${has(a.manager) ? `<div class="memo"><h4 class="sec-h">유지 관리 · MAINTENANCE</h4><p>${esc(a.manager)}</p></div>` : ""}
        ${trait("상세 기록 · NOTES", a.bio)}
      </div>
    </div>
    ${canEdit ? `<div class="m-actions" id="fileActions"><button class="btn danger" id="delAgent">삭제</button><button class="btn primary" id="editAgent">수정</button></div>` : ""}`;
  openModal("fileScrim");
  $("savePng").onclick = ()=> saveBadgePng(a);
  m.querySelectorAll("[data-rel]").forEach(b=>b.onclick=()=>openFile(b.dataset.rel));
  if(scrollTo==="access") setTimeout(()=>{ const el = $("access"); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); }, 60);
  if(canEdit){
    $("editAgent").onclick = ()=>{ closeModal("fileScrim"); openEditor(a.id); };
    $("delAgent").onclick = ()=>{
      $("fileActions").innerHTML = `<span class="confirm">${esc(a.callsign)} 을(를) 명부에서 삭제할까요? 되돌릴 수 없습니다.</span><button class="btn" id="delNo">취소</button><button class="btn danger" id="delYes">삭제</button>`;
      $("delNo").onclick = ()=> openFile(a.id);
      $("delYes").onclick = async ()=>{
        $("delYes").disabled = true; $("delYes").textContent = "삭제하는 중…";
        const before = S.data.agents;
        try{
          S.data.agents = before.filter(x=>x.id!==a.id);
          await commitData(`오퍼레이터 삭제: ${a.callsign}`);
          if(a.photo && a.photo.startsWith("assets/")) ghDeleteFile(a.photo, `오퍼레이터 사진 삭제: ${a.callsign}`);
          closeModal("fileScrim"); renderAll(); toast("삭제했습니다");
        }catch(err){ S.data.agents = before; toast(ghError(err)); $("delYes").disabled = false; $("delYes").textContent = "삭제"; }
      };
    };
  }
}

/* ============ editor ============ */
function nextNo(){ let m = 0; agents().forEach(a=>{ const r = /(\d+)\s*$/.exec(a.no||""); if(r) m = Math.max(m, +r[1]); }); return "MNG-" + String(m+1).padStart(4,"0"); }
function newId(){ return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function nextAssetNo(){ let m = 2200; assets().forEach(a=>{ const r = /(\d+)\s*$/.exec(a.assetNo||""); if(r) m = Math.max(m, +r[1]); }); return "EQ-" + String(m + 7).padStart(4,"0"); }
function openEditor(id, kind){
  const a = id ? {...agents().find(x=>x.id===id)} : {team: S.team!=="all" ? +S.team : 1, status:"ACTIVE", no:"", kind: kind||"personnel"};
  S.editing = {id, photo:a.photo||"", photoData:null, photoPos:a.photoPos||"30%",
    links:(a.links||[]).map(l=>({...l})), fields:(a.fields||[]).map(f=>({...f})), rels:(a.rels||[]).map(r=>({...r})),
    stats: (a.stats && a.stats.length) ? a.stats.map(s=>({...s})) : AXES.map(([k])=>({k, v:5}))};
  const m = $("editModal"); m.style.setProperty("--tc", teamOf(a).c);
  const opt = (obj, cur, lab) => Object.keys(obj).map(k=>`<option value="${esc(k)}" ${String(k)===String(cur)?"selected":""}>${esc(lab(k))}</option>`).join("");
  const v = k => esc(a[k] ?? "");
  m.innerHTML = `<button class="x" data-close="editScrim" aria-label="닫기">×</button>
  <div class="m-head"><span>${id?(a.kind==="asset"?"자산 기록 수정":"인사기록 수정"):(a.kind==="asset"?"신규 자산 등록":"신규 오퍼레이터 등록")} · PERSONNEL CARD</span></div>
  <form id="agentForm" novalidate>
    <div class="form">
      <div class="photo-pick">
        <div id="pv"></div>
        <div class="btns"><label class="btn sm" for="photoIn">사진 올리기</label><button type="button" class="btn sm" id="photoRm">사진 빼기</button></div>
        <input type="file" id="photoIn" accept="image/*" hidden>
        <label class="f" style="margin-top:12px">사진 위치<select id="fPos"><option value="0%">위</option><option value="30%">위쪽</option><option value="50%">가운데</option><option value="100%">아래</option></select></label>
        <small>세로 3:4 비율로 보입니다. 큰 사진은 자동으로 줄여서 올립니다.</small>
      </div>
      <div class="fgrid inside">
        <label class="f">콜사인 *<input id="fCs" maxlength="40" value="${v("callsign")}" placeholder="예: KAKAPO"></label>
        <input type="hidden" id="fNo" value="">
        <label class="f">분류<select id="fTeam">${opt(TEAMS,a.team,k=>TEAMS[k].name+" · "+TEAMS[k].en)}</select></label>
        <label class="f">등재 구분<select id="fKind"><option value="personnel" ${a.kind!=="asset"?"selected":""}>인사기록 (오퍼레이터)</option><option value="asset" ${a.kind==="asset"?"selected":""}>장비·비표준 자산</option></select></label>
        <div class="fgrid three full asset-only" ${a.kind==="asset"?"":"hidden"}>
          <label class="f">자산 번호<input id="fAssetNo" maxlength="20" value="${v("assetNo")}" placeholder="비우면 자동"></label>
          <label class="f">취득 경위<input id="fAcq" maxlength="60" value="${v("acquisition")}" placeholder="예: 잉여 군수품 인수"></label>
          <label class="f">자산 상태<input id="fAssetSt" maxlength="30" value="${v("assetStatus")}" placeholder="예: 운용 중"></label>
        </div>
        <select id="fSt" hidden><option value="ACTIVE" selected>ACTIVE</option></select>
        <label class="f">실명<input id="fName" maxlength="60" value="${v("name")}"></label>
        <label class="check" style="align-self:end;padding-bottom:11px"><input type="checkbox" id="fHide" ${a.nameHidden?"checked":""}> 방문자에게 실명 가리기</label>
        <label class="check full teaser-check"><input type="checkbox" id="fTeaser" ${a.teaser?"checked":""}> <b>등록 전으로 올리기</b> — 방문자에게는 사진만 보이고 콜사인·분류·나머지 정보는 숨겨집니다. 인원 수에도 들어가지 않습니다. 체크를 풀면 정식 등록됩니다.</label>
        <div class="fgrid three full">
          <label class="f">나이<input id="fAge" maxlength="20" value="${v("age")}" placeholder="예: 34세"></label>
          <label class="f">생일<input id="fBirth" maxlength="20" value="${v("birthday")}" placeholder="예: 3월 14일"></label>
          <label class="f">키<input id="fHeight" maxlength="20" value="${v("height")}" placeholder="예: 188cm"></label>
        </div>
        <div class="fgrid full">
          <label class="f">의무 경고 <em>— ID 카드에 붉게 표시</em><input id="fMed" maxlength="40" value="${v("medAlert")}" placeholder="예: 진통제 거부"></label>
          <label class="f">비상연락처<input id="fKin" maxlength="40" value="${v("kin")}" placeholder="예: 없음"></label>
        </div>
        <label class="f full">주무기<input id="fWeapon" maxlength="80" value="${v("weapon")}"></label>
        <label class="f full">한 줄 소개 <em>— 인사기록 상단에 인용문처럼 표시</em><input id="fQuote" maxlength="140" value="${v("quote")}"></label>
      </div>

      <div class="fsec"><h3>바로가기 링크</h3><small>같은 캐릭터를 올린 플랫폼마다 하나씩</small></div>
      <div class="rows" id="linkRows"></div>
      <div class="full"><button type="button" class="btn sm" id="addLink">+ 링크 추가</button></div>

      <div class="fsec"><h3>능력 평가</h3><small>기준 10 · 10을 넘기면 규격 외로 붉게 표시 · 최대 15</small></div>
      <div class="eval-ed"><div class="rows" id="statRows"></div><div id="radarPv"></div></div>
      <div class="full" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" id="addStat">+ 항목 추가</button><button type="button" class="btn sm" id="resetStat">기본 항목으로</button></div>

      <div class="fsec"><h3>특징</h3><small>비워둔 칸은 인사기록에 나오지 않습니다</small></div>
      <div class="fgrid">
        <label class="f full">키워드 <em>— 쉼표로 구분</em><input id="fKw" maxlength="200" value="${v("keywords")}" placeholder="예: 시끄러움, 골초, 도박, 빨래 안 함"></label>
        <label class="f full">전투 방식<textarea id="fCombat" maxlength="1500" placeholder="작전에서 어떻게 움직이는지, 맡는 역할, 선호하는 장비와 거리">${v("combat")}</textarea></label>
        <label class="f full">거점 평판<textarea id="fRep" maxlength="1500" placeholder="거점에서 다른 오퍼레이터들이 이 사람을 어떻게 말하는지. 콜사인이 붙은 이유, 소문, 별명">${v("reputation")}</textarea></label>
        <label class="f full">개조·신체 특이사항<textarea id="fRem" maxlength="1500" placeholder="개조 부위, 인외·반인간으로서의 신체 특징, 약점">${v("remarks")}</textarea></label>
        <label class="f full">유지 관리<textarea id="fMgr" maxlength="1000" placeholder="복용 중인 유지 약물(거부반응 억제제, 신경 안정제, 나노머신 유지제 등)과 주기, 의무실 메모">${v("manager")}</textarea></label>
        <label class="f full">트레일러<textarea id="fTrailer" maxlength="1000" placeholder="숙소 트레일러 안이 어떻게 생겼는지. 들어가 보면 어떤 사람인지 보이는 것들">${v("trailer")}</textarea></label>
        <label class="f">파견 횟수 (회)<input id="fCases" inputmode="numeric" maxlength="6" value="${v("cases")}"></label>
        <label class="f">팀장 지휘 (회)<input id="fHigh" inputmode="numeric" maxlength="6" value="${v("highrisk")}"></label>
        <label class="f full">지휘 자격<input id="fDisc" maxlength="60" value="${v("discipline")}" placeholder="예: 보유 / 미보유 / 박탈"></label>
      </div>

      <div hidden>      <div class="fsec"><h3>관련 인물</h3><small>같은 분대 동료, 라이벌, 악연 등 한 줄씩</small></div>       <div class="rows" id="relRows"></div>       <div class="full"><button type="button" class="btn sm" id="addRel">+ 관계 추가</button></div> </div>

      <div class="fsec"><h3>기타 정보</h3><small>국적, 출신, 취미 등 자유 항목</small></div>
      <div class="rows" id="customRows"></div>
      <div class="full"><button type="button" class="btn sm" id="addField">+ 항목 추가</button></div>
      <label class="f full">상세 기록 <em>— 길게 쓰는 설정·메모</em><textarea id="fBio" maxlength="8000" style="min-height:140px">${v("bio")}</textarea></label>
    </div>
    <div class="err" id="fErr"></div>
    <div class="m-actions"><button type="button" class="btn" data-close="editScrim">취소</button><button type="submit" class="btn primary" id="fSave">${id?"저장":"등록"}</button></div>
  </form>`;
  $("fPos").value = S.editing.photoPos;
  drawPreview(); drawLinks(); drawStats(); drawCustom(); drawRels();
  openModal("editScrim");
  $("photoIn").onchange = async e=>{
    const f = e.target.files[0]; e.target.value = ""; if(!f) return;
    try{ $("fErr").textContent = "사진을 처리하는 중입니다…"; S.editing.photoData = await compress(f, 1000, 450000); $("fErr").textContent = ""; drawPreview(); }
    catch(err){ $("fErr").textContent = "사진을 읽지 못했습니다. 다른 이미지 파일로 시도해 주세요."; }
  };
  $("photoRm").onclick = ()=>{ S.editing.photo = ""; S.editing.photoData = null; drawPreview(); };
  $("fPos").onchange = e=>{ S.editing.photoPos = e.target.value; drawPreview(); };
  ["fCs","fName","fHide","fBirth","fMed","fWeapon"].forEach(k=>$(k).addEventListener("input", drawPreview));
  $("fKind").addEventListener("change", ()=>{ document.querySelector("#editModal .asset-only").hidden = $("fKind").value!=="asset"; drawPreview(); });
  ["fAssetNo"].forEach(k=>$(k).addEventListener("input", drawPreview));
  $("fTeam").addEventListener("change", ()=>{ m.style.setProperty("--tc", TEAMS[$("fTeam").value].c); drawPreview(); drawRadarPv(); });
  $("addLink").onclick = ()=>{ syncLinks(); S.editing.links.push({label:"",url:""}); drawLinks(); const r = $("linkRows").querySelectorAll("[data-u]"); r[r.length-1]?.focus(); };
  $("addStat").onclick = ()=>{ syncStats(); if(S.editing.stats.length>=8){ $("fErr").textContent = "평가 항목은 8개까지 넣을 수 있습니다."; return; } S.editing.stats.push({k:"",v:5}); drawStats(); const r = $("statRows").querySelectorAll("[data-sk]"); r[r.length-1]?.focus(); };
  $("resetStat").onclick = ()=>{ S.editing.stats = AXES.map(([k])=>({k, v:5})); drawStats(); };
  $("addRel").onclick = ()=>{ syncRels(); S.editing.rels.push({to:"",name:"",rel:"",note:""}); drawRels(); };
  $("addField").onclick = ()=>{ syncCustom(); S.editing.fields.push({k:"",v:""}); drawCustom(); const r = $("customRows").querySelectorAll("[data-k]"); r[r.length-1]?.focus(); };
  $("agentForm").onsubmit = saveAgent;
}
function formAgent(){
  const g = id => $(id).value.trim();
  return { callsign:g("fCs"), no:g("fNo"), team:+$("fTeam").value, status:$("fSt").value, name:g("fName"), nameHidden:$("fHide").checked, teaser:$("fTeaser").checked, kind:$("fKind").value, assetNo:$("fKind").value==="asset" ? (g("fAssetNo") || nextAssetNo()) : g("fAssetNo"), acquisition:g("fAcq"), assetStatus:g("fAssetSt"),
    age:g("fAge"), birthday:g("fBirth"), height:g("fHeight"), medAlert:g("fMed"), kin:g("fKin"),
    weapon:g("fWeapon"), quote:g("fQuote"), keywords:g("fKw"), combat:g("fCombat"), reputation:g("fRep"), remarks:g("fRem"), manager:g("fMgr"), trailer:g("fTrailer"),
    cases:g("fCases"), highrisk:g("fHigh"), discipline:g("fDisc"), bio:$("fBio").value.replace(/\s+$/,""),
    photoPos:S.editing.photoPos };
}
function drawPreview(){
  const a = {...formAgent(), id:"pv", links:S.editing.links, photo: S.editing.photoData || S.editing.photo};
  const w = S.admin; S.admin = false; $("pv").innerHTML = badgeHTML(a,false); S.admin = w;
}
function syncLinks(){ S.editing.links = [...$("linkRows").querySelectorAll(".lrow")].map(r=>({label:r.querySelector("[data-l]").value, url:r.querySelector("[data-u]").value})); }
function drawLinks(){
  $("linkRows").innerHTML = S.editing.links.map((l,i)=>`<div class="lrow"><input class="inp" data-l list="platforms" maxlength="20" placeholder="플랫폼" value="${esc(l.label)}" aria-label="플랫폼 이름"><input class="inp" data-u type="url" maxlength="500" placeholder="https://" value="${esc(l.url)}" aria-label="링크 주소"><button type="button" class="rm" data-rml="${i}" aria-label="링크 삭제">×</button></div>`).join("")
    || `<div class="hint">아직 링크가 없습니다. 링크가 하나면 ID 카드에서 바로 열리고, 여러 개면 인사기록 창에 플랫폼별 버튼으로 나옵니다.</div>`;
  $("linkRows").querySelectorAll("[data-rml]").forEach(b=>b.onclick=()=>{ syncLinks(); S.editing.links.splice(+b.dataset.rml,1); drawLinks(); drawPreview(); });
  $("linkRows").querySelectorAll(".lrow").forEach(r=>{ const u = r.querySelector("[data-u]"), l = r.querySelector("[data-l]");
    u.addEventListener("change", ()=>{ if(!l.value.trim()){ const g = guessPlatform(u.value.trim()); if(g) l.value = g; } syncLinks(); drawPreview(); }); });
}
function syncStats(){ S.editing.stats = [...$("statRows").querySelectorAll(".srow")].map(r=>({k:r.querySelector("[data-sk]").value, v:+r.querySelector("[data-sv]").value})); }
function drawRadarPv(){ syncStats(); const st = S.editing.stats.filter(s=>s.k.trim()).map(s=>({k:s.k.trim(), v:s.v})); $("radarPv").innerHTML = st.length>=3 ? radarSVG(st, TEAMS[$("fTeam").value].c) : `<div class="hint" style="text-align:center">이름이 있는 항목이 3개 이상이면 그래프가 그려집니다.</div>`; }
function drawStats(){
  $("statRows").innerHTML = S.editing.stats.map((s,i)=>{ const d = AXIS_DESC[(s.k||"").trim()];
    return `<div class="srow"><div class="nm-wrap"><input class="inp" data-sk maxlength="12" value="${esc(s.k)}" placeholder="항목" aria-label="평가 항목 이름">${d?`<small>${esc(d)}</small>`:""}</div><input type="range" data-sv min="0" max="${CAP}" step="1" value="${Math.min(CAP,+s.v||0)}" aria-label="${esc(s.k||"항목")} 점수"><output class="${s.v>MAXV?"over":""}">${s.v}</output><button type="button" class="rm" data-rms="${i}" aria-label="항목 삭제">×</button></div>`; }).join("");
  $("statRows").querySelectorAll(".srow").forEach(r=>{
    const rg = r.querySelector("[data-sv]"), o = r.querySelector("output");
    rg.addEventListener("input", ()=>{ o.textContent = rg.value; o.className = +rg.value>MAXV?"over":""; drawRadarPv(); });
    r.querySelector("[data-sk]").addEventListener("input", drawRadarPv);
  });
  $("statRows").querySelectorAll("[data-rms]").forEach(b=>b.onclick=()=>{ syncStats(); if(S.editing.stats.length<=3){ $("fErr").textContent = "평가 항목은 최소 3개가 필요합니다."; return; } S.editing.stats.splice(+b.dataset.rms,1); drawStats(); });
  drawRadarPv();
}
function syncCustom(){ S.editing.fields = [...$("customRows").querySelectorAll(".crow")].map(r=>({k:r.querySelector("[data-k]").value, v:r.querySelector("[data-v]").value})); }
function drawCustom(){
  $("customRows").innerHTML = S.editing.fields.map((f,i)=>`<div class="crow"><input class="inp" data-k maxlength="30" placeholder="항목 (예: 국적)" value="${esc(f.k)}" aria-label="항목 이름"><input class="inp" data-v maxlength="400" placeholder="내용" value="${esc(f.v)}" aria-label="항목 내용"><button type="button" class="rm" data-rmc="${i}" aria-label="항목 삭제">×</button></div>`).join("");
  $("customRows").querySelectorAll("[data-rmc]").forEach(b=>b.onclick=()=>{ syncCustom(); S.editing.fields.splice(+b.dataset.rmc,1); drawCustom(); });
}
async function saveAgent(e){
  e.preventDefault();
  if(!S.token){ $("fErr").textContent = "저장소가 연결되어 있지 않습니다."; return; }
  syncLinks(); syncStats(); syncCustom(); syncRels();
  const a = formAgent();
  if(!a.callsign){ $("fErr").textContent = "콜사인을 입력해 주세요."; $("fCs").focus(); return; }
  const d1 = agents().find(x=>x.id!==S.editing.id && (x.callsign||"").toLowerCase()===a.callsign.toLowerCase());
  if(d1){ $("fErr").textContent = `콜사인 ${a.callsign}은(는) 이미 ${d1.no||"다른 오퍼레이터"}에게 부여되어 있습니다. 당사는 콜사인을 재사용하지 않습니다.`; return; }
  const d2 = a.no && agents().find(x=>x.id!==S.editing.id && (x.no||"").toLowerCase()===a.no.toLowerCase());
  if(d2){ $("fErr").textContent = `등록번호 ${a.no}는 이미 사용 중입니다.`; return; }
  const links = S.editing.links.filter(l=>l.url.trim());
  const bad = links.find(l=>!safeUrl(l.url));
  if(bad){ $("fErr").textContent = `링크 주소를 확인해 주세요: ${bad.url} (https:// 로 시작해야 합니다)`; return; }
  a.links = links.map(l=>({label:l.label.trim() || guessPlatform(l.url), url:safeUrl(l.url)}));
  a.stats = S.editing.stats.filter(s=>s.k.trim()).map(s=>({k:s.k.trim(), v:Math.max(0,Math.min(CAP,+s.v||0))}));
  a.rels = S.editing.rels.filter(r=>(r.to||r.name.trim()) && (r.rel.trim()||r.note.trim())).map(r=>({to:r.to||"", name:r.to?"":r.name.trim(), rel:r.rel.trim(), note:r.note.trim()}));
  a.fields = S.editing.fields.filter(f=>f.k.trim()||f.v.trim()).map(f=>({k:f.k.trim(), v:f.v.trim()}));
  const id = S.editing.id || newId();
  const prev = agents().find(x=>x.id===id);
  a.id = id; a.createdAt = prev?.createdAt || Date.now(); a.updatedAt = Date.now();
  const btn = $("fSave"); btn.disabled = true;
  const before = S.data.agents;
  try{
    let oldPhoto = null;
    if(S.editing.photoData){
      btn.textContent = "사진 올리는 중…";
      const path = `assets/agents/${id}-${Date.now()}.jpg`;
      a.photo = await uploadImage(S.editing.photoData, path, `오퍼레이터 사진: ${a.callsign}`);
      oldPhoto = prev?.photo;
    } else {
      a.photo = S.editing.photo || "";
      if(!a.photo && prev?.photo) oldPhoto = prev.photo;
    }
    btn.textContent = "저장하는 중…";
    S.data.agents = prev ? before.map(x=>x.id===id ? a : x) : [...before, a];
    await commitData(`${prev?"오퍼레이터 수정":"오퍼레이터 등록"}: ${a.callsign}`);
    if(oldPhoto && oldPhoto !== a.photo && oldPhoto.startsWith("assets/")) ghDeleteFile(oldPhoto, `이전 사진 삭제: ${a.callsign}`);
    closeModal("editScrim"); renderAll();
    toast(PREVIEW ? (prev ? "저장했습니다 (미리보기: 이 브라우저에만 저장)" : `${a.callsign}을(를) 등재했습니다 (미리보기)`) : (prev ? "저장했습니다. 공개 사이트에는 1~2분 뒤 반영됩니다." : `${a.callsign}을(를) 등재했습니다. 공개 사이트에는 1~2분 뒤 반영됩니다.`));
    if(prev) openFile(id);
    else if(S.team!=="all" && String(a.team)!==S.team){ S.team = String(a.team); renderRoster(); }
  }catch(err){ S.data.agents = before; $("fErr").textContent = ghError(err); btn.disabled = false; btn.textContent = S.editing.id?"저장":"등록"; }
}


/* ============ relations ============ */
const REL_TYPES = ["같은 분대","동료","파트너","라이벌","악연","선임","후임","은인","빚진 사이","소꿉친구","전 동료"];
function relsHTML(a){
  const rows = (a.rels||[]).map(r=>{
    const t = r.to ? agents().find(x=>x.id===r.to) : null;
    if(r.to && !t) return "";
    const who = t ? `<button class="rel-who" data-rel="${esc(t.id)}" style="--tc:${teamOf(t).c}"><i></i>${esc(t.callsign)}</button>` : `<span class="rel-who plain">${esc(r.name)}</span>`;
    return `<div class="rel">${who}<span class="rel-type">${esc(r.rel||"관계")}</span><span class="rel-note">${esc(r.note||"")}</span></div>`;
  }).filter(Boolean);
  const back = agents().filter(x=>x.id!==a.id && (x.rels||[]).some(r=>r.to===a.id) && !(a.rels||[]).some(r=>r.to===x.id));
  const backRows = back.map(x=>{ const r = x.rels.find(r=>r.to===a.id);
    return `<div class="rel back"><button class="rel-who" data-rel="${esc(x.id)}" style="--tc:${teamOf(x).c}"><i></i>${esc(x.callsign)}</button><span class="rel-type">${esc(r.rel||"관계")}</span><span class="rel-note">${esc(x.callsign)}의 기록에서 언급됨</span></div>`; });
  if(!rows.length && !backRows.length) return "";
  return `<div class="trait"><h4 class="sec-h">관련 인물 · RELATIONS</h4><div class="rels">${rows.join("")}${backRows.join("")}</div></div>`;
}
function syncRels(){ S.editing.rels = [...$("relRows").querySelectorAll(".rrow")].map(r=>({to:r.querySelector("[data-rt]").value, name:r.querySelector("[data-rn]").value, rel:r.querySelector("[data-rr]").value, note:r.querySelector("[data-rno]").value})); }
function drawRels(){
  const others = agents().filter(x=>x.id!==S.editing.id).sort((a,b)=>String(a.callsign).localeCompare(String(b.callsign)));
  $("relRows").innerHTML = S.editing.rels.map((r,i)=>`<div class="rrow">
      <select class="inp" data-rt aria-label="관련 인물"><option value="">직접 입력 (명부에 없는 인물)</option>${others.map(o=>`<option value="${esc(o.id)}" ${o.id===r.to?"selected":""}>${esc(o.callsign)} · ${esc(o.no||"")}</option>`).join("")}</select>
      <input class="inp" data-rn maxlength="40" placeholder="이름" value="${esc(r.name||"")}" ${r.to?"hidden":""} aria-label="인물 이름">
      <input class="inp" data-rr list="relTypes" maxlength="20" placeholder="관계 (예: 라이벌)" value="${esc(r.rel||"")}" aria-label="관계">
      <input class="inp" data-rno maxlength="120" placeholder="한 줄 설명" value="${esc(r.note||"")}" aria-label="한 줄 설명">
      <button type="button" class="rm" data-rmr="${i}" aria-label="관계 삭제">×</button></div>`).join("")
    || `<div class="hint">명부에 있는 오퍼레이터를 고르면 인사기록에서 눌러서 넘어갈 수 있습니다. 상대의 기록에도 자동으로 표시됩니다.</div>`;
  $("relRows").querySelectorAll(".rrow").forEach(r=>{ const sel = r.querySelector("[data-rt]"), nm = r.querySelector("[data-rn]"); sel.onchange = ()=>{ nm.hidden = !!sel.value; }; });
  $("relRows").querySelectorAll("[data-rmr]").forEach(b=>b.onclick=()=>{ syncRels(); S.editing.rels.splice(+b.dataset.rmr,1); drawRels(); });
}

/* ============ badge → PNG ============ */
function loadURL(src){ return new Promise((res)=>{ if(!src) return res(null); const im = new Image(); im.onload = ()=>res(im); im.onerror = ()=>res(null); im.src = src; }); }
function rr(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
function coverDraw(g, im, x, y, w, h, posY){
  const r = Math.max(w/im.naturalWidth, h/im.naturalHeight), sw = w/r, sh = h/r;
  const sx = (im.naturalWidth - sw)/2, sy = (im.naturalHeight - sh) * (parseFloat(posY)||30)/100;
  g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
}
async function drawBadge(a){
  try{ await document.fonts.ready; }catch(e){}
  const F = getComputedStyle(document.body).fontFamily;
  const t = teamOf(a), SC = 3, W = 360, PAD = 22, med = has(a.medAlert);
  const H = med ? 612 : 578;
  const c = document.createElement("canvas"); c.width = (W+PAD*2)*SC; c.height = (H+PAD*2)*SC;
  const g = c.getContext("2d"); g.scale(SC,SC); g.translate(PAD,PAD);
  const [logo, photo] = await Promise.all([loadURL("assets/logo.png"), loadURL(imgSrc(a.photo))]);
  const LIME = "#E4F020", LINE = "#474B3A";
  const fit = (txt, maxW) => { let s = String(txt); while(g.measureText(s).width > maxW && s.length > 1) s = s.slice(0,-2) + "…"; return s; };
  g.save(); g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 18; g.shadowOffsetY = 8; rr(g,0,0,W,H,18);
  const bg = g.createLinearGradient(0,0,W*.4,H); bg.addColorStop(0,"#343826"); bg.addColorStop(.6,"#262919"); bg.addColorStop(1,"#1F2215"); g.fillStyle = bg; g.fill(); g.restore();
  g.save(); rr(g,0,0,W,H,18); g.clip();
  g.fillStyle = "rgba(255,255,255,.02)"; for(let yy=0; yy<H; yy+=4) g.fillRect(0,yy,W,2);
  // band
  g.fillStyle = "#0B0C08"; g.fillRect(0,0,W,84);
  rr(g, W/2-24, 12, 48, 10, 5); g.fillStyle = "#2A2D1F"; g.fill();
  if(logo) g.drawImage(logo, 16, 32, 42, 42);
  g.textAlign = "left"; g.textBaseline = "middle";
  g.fillStyle = LIME; g.font = `900 14px ${F}`; g.fillText(isAsset(a) ? "EQUIPMENT ASSET" : "ARMED CONTRACTOR", 70, 46);
  g.fillStyle = "#9C9E8F"; g.font = `600 10.5px ${F}`; g.fillText(isAsset(a) ? assetNoOf(a)+" · "+t.en : t.code, 70, 64);
  g.fillStyle = t.c; g.fillRect(0,84,W,3);
  g.save(); g.beginPath(); g.rect(0,87,W,8); g.clip(); g.fillStyle = "#0B0C08"; g.fillRect(0,87,W,8); g.fillStyle = LIME;
  for(let x=-20; x<W+20; x+=16){ g.beginPath(); g.moveTo(x,95); g.lineTo(x+8,95); g.lineTo(x+16,87); g.lineTo(x+8,87); g.closePath(); g.fill(); }
  g.restore();
  // small centered ID photo
  const pw = 150, ph = 200, px = (W-pw)/2, py = 116;
  g.fillStyle = "#3B3E2B"; g.fillRect(px,py,pw,ph);
  if(photo) coverDraw(g, photo, px, py, pw, ph, a.photoPos);
  else { g.fillStyle = "#6E7262"; g.font = `800 44px ${F}`; g.textAlign = "center"; g.fillText((a.callsign||"?").slice(0,2).toUpperCase(), px+pw/2, py+ph/2); }
  g.strokeStyle = LIME; g.lineWidth = 2; const k = 12, m = 5;
  g.beginPath(); g.moveTo(px+m, py+m+k); g.lineTo(px+m, py+m); g.lineTo(px+m+k, py+m); g.stroke();
  g.beginPath(); g.moveTo(px+pw-m, py+ph-m-k); g.lineTo(px+pw-m, py+ph-m); g.lineTo(px+pw-m-k, py+ph-m); g.stroke();
  // callsign + name (centered)
  const lx = 22, lw = W - 44;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  let fs = 32; g.font = `900 ${fs}px ${F}`;
  const cs = (a.callsign||"UNNAMED").toUpperCase(); while(g.measureText(cs).width > lw && fs > 16){ fs -= 2; g.font = `900 ${fs}px ${F}`; }
  g.fillStyle = "#F1F0E6"; g.fillText(cs, W/2, py + ph + 40);
  let y = py + ph + 62; g.font = `500 13px ${F}`; g.fillStyle = "#AFB1A0";
  if(a.name && a.nameHidden){ const w = Math.min(lw, g.measureText(a.name).width+8); g.fillStyle = "#0B0C08"; g.fillRect(W/2-w/2, y-12, w, 17); }
  else if(a.name) g.fillText(fit(a.name, lw), W/2, y);
  y += 16;
  // data rows
  g.strokeStyle = LINE; g.lineWidth = 1;
  [["CLASS", t.en],["BIRTH", a.birthday||"—"],["ARMED", a.weapon||"—"]].forEach(([k2,v])=>{
    g.beginPath(); g.moveTo(lx, y); g.lineTo(lx+lw, y); g.stroke();
    g.fillStyle = "#8E917F"; g.font = `700 10px ${F}`; g.textAlign = "left"; g.fillText(k2, lx, y + 20);
    g.fillStyle = "#ECEBE2"; g.font = `700 14px ${F}`; g.textAlign = "right"; g.fillText(fit(v, lw - 70), lx + lw, y + 21);
    y += 30;
  });
  g.beginPath(); g.moveTo(lx, y); g.lineTo(lx+lw, y); g.stroke(); g.textAlign = "left";
  let by = y + 14;
  if(med){
    g.fillStyle = "#5A1D17"; g.fillRect(lx, by, lw, 24); g.fillStyle = "#E5533F"; g.fillRect(lx, by, 4, 24);
    g.fillStyle = "#FF8A7C"; g.font = `800 10px ${F}`; g.fillText("MED ALERT", lx+12, by+16);
    g.fillStyle = "#FFD9D3"; g.font = `700 13px ${F}`; g.fillText(fit(a.medAlert, lw-100), lx+88, by+17);
    by += 34;
  }
  let h = hash32(a.id||a.callsign), x = 0; const bh = 22; g.fillStyle = "#D9D8CC";
  while(x < 100){ const w = .6 + (h % 5) * .55; h = Math.imul(h ^ (h>>>13), 1597334677)>>>0; const gp = .6 + (h % 4) * .6; h = Math.imul(h ^ (h>>>11), 2654435761)>>>0;
    g.fillRect(lx + lw*x/100, by, Math.min(lw*w/100, lw - lw*x/100), bh); x += w + gp; }
  g.fillStyle = "#6E7262"; g.font = `700 8px ${F}`; g.fillText("PROPERTY OF MERIDIAN SOLUTIONS · IF FOUND CALL CONTRACT DESK", lx, by + bh + 17);
  g.restore();
  g.strokeStyle = "#4A4E3B"; g.lineWidth = 1; rr(g,.5,.5,W-1,H-1,18); g.stroke();
  return c;
}
async function saveBlob(blob, filename){
  const use = window.claude && window.claude.use ? window.claude.use.bind(window.claude) : null;
  if(use){
    const d = await use("downloads").catch(()=>null);
    if(d){ try{ await d.save({filename, data:blob}); return; }catch(e){ if(e && e.code==="cancelled") return; } }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
async function saveBadgePng(a){
  try{
    toast("이미지를 만드는 중입니다…");
    const c = await drawBadge(a);
    const blob = await new Promise(r=>c.toBlob(r, "image/png"));
    await saveBlob(blob, `MERIDIAN-ID-${(a.callsign||"agent").replace(/[^\w가-힣-]/g,"")}.png`);
  }catch(e){ toast("이미지를 만들지 못했습니다."); }
}


/* ============ 제보·목격 게시판 ============ */
const POST_CATS = ["의뢰 문의","채용 문의","민원","기타"];
const POST_STATUS = {
  "접수":{c:"#8A8C7E"}, "검토 중":{c:"#C9A23A"}, "견적 발송":{c:"#5B8BD0"}, "수임":{c:"#B9C93A"}, "답변 완료":{c:"#B9C93A"}, "비공개 처리":{c:"#D9534A"}
};
const reports = () => S.data.reports || (S.data.reports = []);
S.bcat = "all"; S.openPost = null;
function renderBoard(){
  const canEdit = S.admin && S.token;
  $("addPost").hidden = !canEdit;
  const cats = ["all", ...POST_CATS];
  $("bCats").innerHTML = cats.map(c=>`<button data-bcat="${c}" aria-pressed="${S.bcat===c}">${c==="all"?"전체":c}<span class="num">${c==="all"?reports().length:reports().filter(r=>r.cat===c).length}</span></button>`).join("");
  let list = [...reports()].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || (b.createdAt||0)-(a.createdAt||0));
  if(S.bcat!=="all") list = list.filter(r=>r.cat===S.bcat);
  const order = [...reports()].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).map(r=>r.id);
  if(!list.length){ $("bList").innerHTML = `<div class="empty-reg" style="margin-top:0"><b>게시물이 없습니다</b><p>${canEdit?"오른쪽 위 ‘게시물 작성’으로 첫 글을 올려 보세요.":"아직 등록된 게시물이 없습니다."}</p></div>`; return; }
  $("bList").innerHTML = list.map((r,i)=>{
    const st = POST_STATUS[r.status] ? r.status : "접수", hidden = st==="비공개 처리", open = S.openPost===r.id;
    return `<article class="post ${open?"open":""}">
      <button class="post-h" data-post="${esc(r.id)}" aria-expanded="${open}">
        <span class="pn num">${String(order.indexOf(r.id)+1).padStart(3,"0")}</span>
        <span class="pc">${esc(r.cat||"기타")}</span>
        <span class="pt">${hidden ? `<span class="muted">관리자에 의해 비공개 처리된 게시물입니다</span>` : esc(r.title||"(제목 없음)")}</span>
        <span class="pa">${esc(r.author||"익명")}</span>
        <time class="num">${esc(r.date||"")}</time>
        <span class="ps" style="--sc:${POST_STATUS[st].c}">${st}</span>
      </button>
      ${open ? `<div class="post-b">
        ${hidden && !S.admin ? `<p class="muted">이 게시물은 운영 정책에 따라 비공개 처리되었습니다. 작전 관련 정보와 소속 인력의 신상이 포함된 게시물은 제한됩니다.</p>` : `
        ${has(r.place)?`<div class="pmeta"><b>장소</b>${esc(r.place)}</div>`:""}
        <p>${esc(r.body||"")}</p>`}
        ${has(r.reply) ? `<div class="reply"><b>Meridian Solutions 계약지원팀</b><p>${esc(r.reply)}</p></div>` : ""}
        ${canEdit ? `<div class="post-act"><button class="btn sm" data-edit-post="${esc(r.id)}">수정</button><button class="btn sm danger" data-del-post="${esc(r.id)}">삭제</button></div>` : ""}
      </div>` : ""}
    </article>`;
  }).join("");
}
$("bCats").addEventListener("click", e=>{ const b = e.target.closest("[data-bcat]"); if(b){ S.bcat = b.dataset.bcat; renderBoard(); } });
$("bList").addEventListener("click", async e=>{
  const h = e.target.closest("[data-post]"); if(h){ S.openPost = S.openPost===h.dataset.post ? null : h.dataset.post; renderBoard(); return; }
  const ed = e.target.closest("[data-edit-post]"); if(ed){ openPostEditor(ed.dataset.editPost); return; }
  const del = e.target.closest("[data-del-post]");
  if(del){
    if(del.dataset.armed!=="1"){ del.dataset.armed = "1"; del.textContent = "한 번 더 누르면 삭제"; return; }
    const before = S.data.reports; S.data.reports = before.filter(r=>r.id!==del.dataset.delPost);
    try{ await commitData("게시물 삭제"); renderBoard(); toast("삭제했습니다"); }catch(err){ S.data.reports = before; toast(ghError(err)); }
  }
});
$("addPost").onclick = ()=> openPostEditor(null);
function openPostEditor(id){
  const r = id ? {...reports().find(x=>x.id===id)} : {cat:"의뢰 문의", status:"접수", date:new Date().toISOString().slice(0,10).replace(/-/g,".")};
  const opt = (arr, cur) => arr.map(k=>`<option ${k===cur?"selected":""}>${esc(k)}</option>`).join("");
  const m = $("postModal");
  m.innerHTML = `<button class="x" data-close="postScrim" aria-label="닫기">×</button>
  <div class="m-head"><span>${id?"게시물 수정":"게시물 작성"} · 문의 게시판</span></div>
  <form id="postForm" novalidate><div class="form" style="grid-template-columns:1fr">
    <div class="fgrid">
      <label class="f">분류<select id="pCat">${opt(POST_CATS, r.cat)}</select></label>
      <label class="f">처리 상태<select id="pSt">${opt(Object.keys(POST_STATUS), r.status)}</select></label>
      <label class="f full">제목 *<input id="pTitle" maxlength="80" value="${esc(r.title||"")}" placeholder="예: 다음 달 항만 시설 경비 견적 문의드립니다"></label>
      <label class="f">작성자<input id="pAuthor" maxlength="30" value="${esc(r.author||"")}" placeholder="예: desertdad_77 (비우면 익명)"></label>
      <label class="f">날짜<input id="pDate" maxlength="20" value="${esc(r.date||"")}" placeholder="2026.10.06"></label>
      <label class="f full">장소<input id="pPlace" maxlength="80" value="${esc(r.place||"")}" placeholder="예: 네바다주 일리 근처 주유소"></label>
      <label class="f full">본문<textarea id="pBody" maxlength="3000" style="min-height:140px" placeholder="시민이 쓴 말투로. 오타나 구어체도 괜찮습니다.">${esc(r.body||"")}</textarea></label>
      <label class="f full">회사 답변 <em>— 비워두면 표시되지 않음</em><textarea id="pReply" maxlength="1200" placeholder="건조한 공문 말투 권장. 예: 문의 감사합니다. 해당 건은 계약지원팀기관에 이관되었습니다.">${esc(r.reply||"")}</textarea></label>
    </div></div>
    <div class="err" id="pErr"></div>
    <div class="m-actions"><button type="button" class="btn" data-close="postScrim">취소</button><button type="submit" class="btn primary" id="pSave">${id?"저장":"올리기"}</button></div>
  </form>`;
  openModal("postScrim");
  $("postForm").onsubmit = async e=>{
    e.preventDefault();
    const g = k => $(k).value.trim();
    if(!g("pTitle")){ $("pErr").textContent = "제목을 입력해 주세요."; return; }
    const post = {id: id || ("p"+Date.now().toString(36)), cat:g("pCat"), status:g("pSt"), title:g("pTitle"), author:g("pAuthor"), date:g("pDate"), place:g("pPlace"), body:$("pBody").value.replace(/\s+$/,""), reply:$("pReply").value.replace(/\s+$/,""), createdAt: r.createdAt || Date.now()};
    const before = reports(); S.data.reports = id ? before.map(x=>x.id===id?post:x) : [...before, post];
    $("pSave").disabled = true; $("pSave").textContent = "저장하는 중…";
    try{ await commitData(id?`게시물 수정: ${post.title}`:`게시물 작성: ${post.title}`); closeModal("postScrim"); S.openPost = post.id; renderBoard(); toast("저장했습니다"); }
    catch(err){ S.data.reports = before; $("pErr").textContent = ghError(err); $("pSave").disabled = false; $("pSave").textContent = id?"저장":"올리기"; }
  };
}
// 시민 제보 접수 (연출용: 저장·전송하지 않음)
$("openTip").onclick = ()=>{ $("tipForm").hidden = false; $("tipDone").hidden = true; $("tipForm").reset(); openModal("tipScrim"); };
$("tipForm").addEventListener("submit", e=>{
  e.preventDefault();
  const no = `MS-${new Date().toISOString().slice(2,10).replace(/-/g,"")}-${String(Math.floor(Math.random()*9000)+1000)}`;
  $("tipNo").textContent = no; $("tipForm").hidden = true; $("tipDone").hidden = false;
});

/* ============ 사원증 발급 (채용 페이지 · 저장 안 함) ============ */
const UNITS = {
  "c1":{name:"인외", en:"NON-HUMAN", code:"CLASS 01 · NON-HUMAN", c:"#7A5A9C"},
  "c2":{name:"개조인간", en:"AUGMENTED", code:"CLASS 02 · AUGMENTED", c:"#3E6BA3"},
  "c3":{name:"반인간", en:"DESIGNED", code:"CLASS 03 · DESIGNED", c:"#467D58"},
  "c4":{name:"인간", en:"BASELINE", code:"CLASS 04 · BASELINE", c:"#8A7B4E"},
  "nw":{name:"배치 대기", en:"—", code:"PENDING ASSIGNMENT", c:"#8A8C7E"}
};
const ID = {photo:"", pos:"30%"};
function idAgent(){
  const g = k => $(k).value.trim(), u = UNITS[$("idUnit").value];
  return {id:"me", callsign:g("idCs") || g("idName"), name:g("idCs") ? g("idName") : "", nameHidden:$("idHide").checked, no:g("idNo"), birthday:g("idBlood"), status:"ACTIVE", photo:ID.photo, photoPos:ID.pos, _unit:u};
}
function drawId(){ const w = S.admin; S.admin = false; $("idPv").innerHTML = badgeHTML(idAgent(), false); S.admin = w; }
document.addEventListener("click", e=>{ if(e.target.closest("[data-open-id]")) $("openIdGen").click(); });
$("openIdGen").onclick = ()=>{
  if(!$("idNo").value) $("idNo").value = "MNG-" + String(Math.floor(Math.random()*8000)+1000);
  drawId(); openModal("idScrim");
};
["idCs","idName","idNo","idBlood","idUnit","idHide","idPos"].forEach(k=>$(k).addEventListener("input", ()=>{ if(k==="idPos") ID.pos = $("idPos").value; drawId(); }));
$("idPhoto").addEventListener("change", async e=>{
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  try{ ID.photo = await compress(f, 1000, 600000); drawId(); }catch(err){ toast("사진을 읽지 못했습니다."); }
});
$("idSave").onclick = ()=>{ const a = idAgent(); if(!a.callsign && !a.name){ toast("이름이나 콜사인을 하나 이상 입력해 주세요."); return; } saveBadgePng(a); };

/* ============ image ============ */
function loadImg(file){ return new Promise((res,rej)=>{ const u = URL.createObjectURL(file); const im = new Image(); im.onload = ()=>res(im); im.onerror = ()=>{ URL.revokeObjectURL(u); rej(new Error("img")); }; im.src = u; }); }
async function compress(file, maxSide, maxLen){
  const im = await loadImg(file);
  let scale = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  for(let p=0;p<6;p++){
    const c = document.createElement("canvas"); c.width = Math.max(1,Math.round(im.naturalWidth*scale)); c.height = Math.max(1,Math.round(im.naturalHeight*scale));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(im,0,0,c.width,c.height);
    for(let q=.9;q>=.55;q-=.07){ const d = c.toDataURL("image/jpeg", q); if(d.length<=maxLen) return d; }
    scale *= .8;
  }
  throw new Error("too big");
}

/* ============ modal / toast ============ */
let lastFocus = null;
function openModal(id){ lastFocus = document.activeElement; $(id).hidden = false; document.body.style.overflow = "hidden"; $(id).scrollTop = 0; const f = $(id).querySelector("input:not([type=hidden]):not([hidden]),.x"); if(f) setTimeout(()=>f.focus({preventScroll:true}), 30); }
function closeModal(id){ $(id).hidden = true; if([...document.querySelectorAll(".scrim")].every(s=>s.hidden)) document.body.style.overflow = ""; if(lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({preventScroll:true}); }
document.querySelectorAll(".scrim").forEach(s=>s.addEventListener("mousedown", e=>{ if(e.target===s) closeModal(s.id); }));
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ const o = [...document.querySelectorAll(".scrim")].filter(s=>!s.hidden).pop(); if(o) closeModal(o.id); } });
let tT; function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(tT); tT = setTimeout(()=>t.hidden = true, 3200); }

/* ============ auth ============ */
let fails = 0;
function setAdmin(on){
  S.admin = on; document.body.classList.toggle("is-admin", on);
  if(on) store.set("mng-staff","1",true); else store.del("mng-staff",true);
  renderAll();
}
async function connectToken(tok, quiet){
  if(PREVIEW){ S.token = "preview"; setSync("미리보기 · 이 브라우저에 저장"); await pullRemote(); return; }
  if(!S.repo) throw Object.assign(new Error("repo"), {status:404});
  S.token = tok;
  const info = await gh("GET", "");
  if(!info) throw Object.assign(new Error("repo"), {status:404});
  if(info.permissions && !info.permissions.push) throw Object.assign(new Error("perm"), {status:403});
  store.set("mng-gh-token", tok);
  setSync(`저장소 연결됨 · ${S.repo}`);
  await pullRemote();
  if(!quiet) toast("저장소에 연결했습니다. 이제 오퍼레이터를 등록할 수 있습니다.");
}
function openLogin(){
  $("lgResult").textContent = ""; $("lgResult").className = "result";
  $("loginStep").hidden = S.admin; $("ghStep").hidden = !S.admin;
  $("repoName").textContent = S.repo || "config.js에 repo를 적어 주세요";
  openModal("loginScrim");
}
$("footLogin").onclick = ()=>{ if(S.admin && S.token) go("roster"); else openLogin(); };
$("headLogin").onclick = ()=>{ if(S.admin && S.token) go("roster"); else openLogin(); };
if(location.hash === "#staff") setTimeout(openLogin, 0);
$("logout").onclick = ()=>{ setAdmin(false); toast("로그아웃했습니다"); };
$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const r = $("lgResult");
  if(!CFG.adminId || !CFG.passHash){ r.className = "result no"; r.textContent = "관리자 계정이 아직 설정되지 않았습니다. setup.html에서 만든 값을 config.js에 넣어 주세요."; return; }
  if(fails >= 5){ r.className = "result no"; r.textContent = "인증 시도가 너무 많습니다. 페이지를 새로 고친 뒤 다시 시도하세요."; return; }
  r.className = "result"; r.textContent = "확인 중…";
  const id = $("lgId").value.trim(), pw = $("lgPw").value;
  const h = await sha256(`menagerie::${id}::${pw}`);
  await new Promise(res=>setTimeout(res, 500));
  if(id === CFG.adminId && h === CFG.passHash){
    fails = 0; $("lgPw").value = "";
    r.className = "result ok"; r.textContent = "ACCESS GRANTED";
    setAdmin(true);
    const saved = PREVIEW ? "preview" : store.get("mng-gh-token");
    if(saved){
      try{ await connectToken(saved, true); closeModal("loginScrim"); go("roster"); toast("관리자 모드입니다."); return; }
      catch(err){ store.del("mng-gh-token"); S.token = null; r.className = "result no"; r.textContent = ghError(err); }
    } else { r.textContent = ""; }
    $("loginStep").hidden = true; $("ghStep").hidden = false; $("repoName").textContent = S.repo || "config.js에 repo를 적어 주세요";
    setTimeout(()=>$("ghTok").focus(), 30);
  } else {
    fails++; r.className = "result no"; r.textContent = "ACCESS DENIED · 아이디 또는 비밀번호가 맞지 않습니다";
  }
});
$("ghForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const tok = $("ghTok").value.trim(), r = $("lgResult");
  if(!tok){ r.className = "result no"; r.textContent = "토큰을 입력해 주세요."; return; }
  r.className = "result"; r.textContent = "저장소 확인 중…";
  try{ await connectToken(tok); $("ghTok").value = ""; closeModal("loginScrim"); go("roster"); }
  catch(err){ S.token = null; r.className = "result no"; r.textContent = ghError(err); }
});
$("ghSkip").onclick = ()=>{ closeModal("loginScrim"); setSync("저장소 미연결 · 보기 전용", true); toast("보기 전용 관리자 모드입니다. 저장하려면 직원 전용 메뉴에서 토큰을 연결하세요."); };
$("logout").addEventListener("click", ()=>{ S.token = null; loadPublic(); });

/* ============ boot ============ */
const h0 = location.hash.replace("#","");
if(["roster","recruit"].includes(h0)) go(h0, null, false);
loadPublic();
if(store.get("mng-staff", true) === "1"){
  setAdmin(true);
  const saved = PREVIEW ? "preview" : store.get("mng-gh-token");
  if(saved) connectToken(saved, true).catch(()=>{ S.token = null; setSync("저장소 연결 실패 · 다시 로그인하세요", true); });
  else setSync("저장소 미연결 · 보기 전용", true);
}
if(["about","anomaly","org","careers","news"].includes(h0)) setTimeout(()=>go("home", h0, false), 50);
/* ============ 거점 안내도 ============ */
const ZONES = {
  A:{code:"ZONE A", name:"조립동", sub:"훈련장 · 정비고", body:"옛 공장의 조립 라인이 있던 대형 동입니다. 훈련장과 차량·장비 정비고로 함께 사용합니다. 천장이 높아 체격이 큰 인력과 대형 장비를 모두 수용합니다.", tags:["실내 훈련","차량 정비","장비 보관"]},
  C:{code:"ZONE C", name:"관리동", sub:"브리핑실 · 식당", body:"옛 관리동을 고쳐 브리핑실과 식당으로 사용합니다. 식당은 당번제로 운영되며, 그날의 당번에 따라 식단이 달라집니다.", tags:["브리핑","식당","휴게"]},
  H:{code:"ROOF", name:"옥상 헬리패드", sub:"관리동 옥상", body:"파견 출발과 복귀에 사용합니다. 공항과 국경이 가까워 거점에서 작전 지역까지의 이동이 빠릅니다.", tags:["항공 이동","파견 출발·복귀"]},
  T:{code:"ZONE T", name:"트레일러 숙소", sub:"1인 1트레일러", body:"부지에 늘어선 트레일러를 오퍼레이터 한 명당 한 대씩 배정합니다. 내부는 개인 공간이며 꾸미기에 제한이 없습니다. 개인 냉난방 기구 반입이 가능합니다.", tags:["개인 숙소","냉난방 기구 반입 가능"]},
  R:{code:"B1", name:"지하 사격장", sub:"실내 사격 훈련", body:"지하층의 실내 사격 훈련 시설입니다. 소음 제한 없이 상시 사용할 수 있습니다.", tags:["상시 개방","실탄 사격"]},
  M:{code:"B1", name:"의무실", sub:"치료 · 개조 정비", body:"부상 치료와 의체·개조 부위의 정비를 함께 맡습니다. 개조 인력의 유지 약물도 이곳에서 지급합니다.", tags:["부상 치료","의체 정비","유지 약물 지급"]}
};
function showZone(k){
  const z = ZONES[k]; if(!z || !$("bmInfo")) return;
  document.querySelectorAll(".bm-z").forEach(g=>g.classList.toggle("on", g.dataset.z===k));
  $("bmInfo").innerHTML = `<small>${z.code}</small><b>${z.name}</b><span class="sub">${z.sub}</span><p>${z.body}</p><div class="tags">${z.tags.map(t=>`<i>${t}</i>`).join("")}</div>`;
}
document.querySelectorAll(".bm-z").forEach(g=>{
  g.addEventListener("click", ()=>showZone(g.dataset.z));
  g.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); showZone(g.dataset.z); } });
});
showZone("A");

/* ============ 토큰 삭제 ============ */
if($("tokenDel")){
  if(PREVIEW) $("tokenDel").style.setProperty("display","none","important");
  $("tokenDel").onclick = ()=>{ store.del("mng-gh-token"); S.token = null; setSync("저장소 미연결 · 보기 전용", true); renderAll(); toast("이 브라우저에서 GitHub 토큰을 지웠습니다."); };
}
})();
