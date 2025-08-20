/****************************************************
 * Woenw Trade — V0.7.15 (Pocket-only, All sets, Grid only)
 * - Multi-selects Type & Rareté compacts (dropdown + checkboxes).
 * - Le reste : identique à 0.7.14 (tri, filtres, images, patch rareté…).
 ****************************************************/

/* ========== 1) CONFIG ========== */
const DATA_SOURCE  = "tcgdex"; window.DATA_SOURCE = DATA_SOURCE;
let   TCGDEX_LANG  = "fr";    const ALT_LANG = (TCGDEX_LANG === 'fr' ? 'en' : 'fr');
const API_BASE     = "https://api.tcgdex.net/v2";
const IMG_QUALITY  = "low", IMG_EXT = "webp";
const POOL_SIZE_PER_SET = 6, SET_FETCH_CONCURRENCY = 2;

// Overrides rareté (ID complet)
const RARITY_ID_OVERRIDES = new Map([ ['a1-265','2 star'], ['a1-279','2 star'] ]);

/* ========== 2) STATE ========== */
let ALL_SETS = [];             // {codeUpper, codeLower, name, releaseDate}
let ALL_CARDS = [];            // cartes normalisées
let FILTERED  = [];
const cardsBySet = new Map();  // codeLower -> [cards]

let currentProfile = "Pocho";
let userData = { wishlist: [], doublons: [] };

/* ========== 3) HELPERS GÉNÉRAUX ========== */
const qs = (s,p=document)=>p.querySelector(s);
const norm = s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
function setLoading(on, text){ const el=qs('#loader'); if(!el) return; el.style.display=on?'block':'none'; if(text) el.textContent=text; }
const humanCount = n=>`${n.toLocaleString('fr-FR')} ${n>1?'cartes':'carte'}`;
const getStorageKey=()=>`woenwData-v07-${currentProfile}`;
function loadUserData(){ const raw=localStorage.getItem(getStorageKey()); userData = raw?JSON.parse(raw):{wishlist:[],doublons:[]}; }
function saveUserData(){ localStorage.setItem(getStorageKey(), JSON.stringify(userData)); }
const getSelectedValues = sel => Array.from(qs(sel)?.selectedOptions || []).map(o=>o.value).filter(v=>v !== "");

/* ========== 4) TYPES (canon FR) & EMOJIS ========== */
const TYPE_EMOJI = {
  "Plante":"🌿","Feu":"🔥","Eau":"💧","Électrique":"⚡","Electrique":"⚡","Combat":"🥊","Psy":"🔮",
  "Obscurité":"🌑","Métal":"🛡️","Incolore":"⭐","Dragon":"🐉","Fée":"✨","Glace":"❄️","Roche":"🪨",
  "Grass":"🌿","Fire":"🔥","Water":"💧","Lightning":"⚡","Fighting":"🥊","Psychic":"🔮",
  "Darkness":"🌑","Metal":"🛡️","Colorless":"⭐","Dragon":"🐉","Fairy":"✨","Ice":"❄️","Rock":"🪨"
};
const TYPE_CANON_MAP = new Map([
  ['grass','Plante'], ['plante','Plante'],
  ['fire','Feu'], ['feu','Feu'],
  ['water','Eau'], ['eau','Eau'],
  ['lightning','Électrique'], ['electrique','Électrique'], ['électrique','Électrique'],
  ['fighting','Combat'], ['combat','Combat'],
  ['psychic','Psy'], ['psy','Psy'],
  ['darkness','Obscurité'], ['obscurite','Obscurité'], ['obscurité','Obscurité'],
  ['metal','Métal'], ['métal','Métal'],
  ['colorless','Incolore'], ['incolore','Incolore'],
  ['dragon','Dragon'], ['fairy','Fée'], ['fee','Fée'], ['fée','Fée']
]);
const canonType = t => TYPE_CANON_MAP.get(norm(t)) || (t ? t.charAt(0).toUpperCase()+t.slice(1) : "");

/* ========== 5) RARETÉ — clé stable + emoji ========== */
function countFromString(s){ const r=norm(s);
  if(r.includes("4")||r.includes("quatre")||r.includes("four")) return 4;
  if(r.includes("3")||r.includes("trois") ||r.includes("three")) return 3;
  if(r.includes("2")||r.includes("deux")  ||r.includes("two"))   return 2;
  if(r.includes("1")||r.includes("une")   ||r.includes("un")||r.includes("one")) return 1;
  return null;
}
function parseRarity(r){
  if (!r) return { key:'', emoji:'—', weight:0 };
  const rr = norm(r);
  if (rr.includes('couronne') || rr.includes('crown')) return { key:'crown', emoji:'👑', weight:500 };

  const n0 = countFromString(rr) || 1;
  const n  = Math.max(1, Math.min(n0, 4));

  if (rr.includes('chromatique') || rr.includes('shiny') || rr.includes('arc en ciel') || rr.includes('arc-en-ciel') || rr.includes('rainbow'))
    return { key:`shiny-${n}`,   emoji:'🌈'.repeat(n), weight:400+n };
  if (rr.includes('diamant') || rr.includes('diamond'))
    return { key:`diamond-${n}`, emoji:'💎'.repeat(n), weight:200+n };
  if (rr.includes('etoile') || rr.includes('étoile') || rr.includes('star'))
    return { key:`star-${n}`,    emoji:'⭐'.repeat(n), weight:300+n };
  if (rr.includes('sans') && rr.includes('rarete')) return { key:'none', emoji:'—', weight:0 };

  return { key: rr, emoji: r, weight:100 };
}
function rarityOrderKey(key) {
  if (key === 'crown') return 999;
  const m = /^(\w+)-(\d)$/.exec(key);
  if (!m) return 500;
  const type = m[1], n = Number(m[2]) || 0;
  const base = { diamond: 100, star: 200, shiny: 300 }[type] ?? 800;
  return base + n;
}

/* ========== 6) IMAGES ========== */
function findFirstImageUrl(obj){ let found=null;
  const isImg=v=>typeof v==="string"&&/^(https?:)?\/\/.+\.(png|jpe?g|webp|svg|avif|gif)(\?.*)?$/i.test(v);
  (function walk(o){ if(!o||found) return; if(isImg(o)){found=o;return;}
    if(Array.isArray(o)){ for(const v of o) walk(v); return; }
    if(typeof o==="object"){ for(const k in o) walk(o[k]); }
  })(obj);
  if(found&&found.startsWith("//")) found="https:"+found;
  return found;
}
function normalizeLocalId(card){ const raw=card?.localId||(card?.id?.includes("-")?card.id.split("-")[1]:""); return raw?String(raw).padStart(3,"0"):""; }
function ensureAssetUrl(u){ if(!u) return ""; let s=String(u);
  if(s.startsWith("//")) s="https:"+s;
  const looks=/^https?:\/\/assets\.tcgdex\.net\/[^?#]+$/i.test(s);
  const hasExt=/\.(png|jpe?g|webp)(\?.*)?$/i.test(s);
  if(looks&&!hasExt) s=s.replace(/\/?$/,"/low.webp");
  return s;
}
function assetUrl(lang,setCodeLower,localId,quality=IMG_QUALITY,ext=IMG_EXT){
  return `https://assets.tcgdex.net/${lang}/tcgp/${setCodeLower}/${localId}/${quality}.${ext}`;
}
function buildAssetFallbacks(card){
  const setCodeLower = (card.setCodeLower || (card.id && card.id.split("-")[0].toLowerCase()) || "");
  const localId = card.number || normalizeLocalId(card) || "";
  if(!setCodeLower || !localId) return [];
  return [
    assetUrl("fr", setCodeLower, localId, "low"),
    assetUrl("fr", setCodeLower, localId, "high"),
    assetUrl("en", setCodeLower, localId, "low"),
    assetUrl("en", setCodeLower, localId, "high"),
  ];
}
function extractCardImageUrl(card){
  const direct=(typeof card.image==="string"?card.image:null)||
    card.image?.small||card.image?.low||card.image?.thumbnail||
    card.images?.small||card.images?.low||card.images?.thumbnail||
    card.illustration?.small||card.illustration?.low||
    card.picture||card.sprite||card.thumbnail||null;
  let url = direct || findFirstImageUrl(card) || "";
  if(url&&url.startsWith("//")) url="https:"+url;
  if(!url&&(card?.localId||card?.id)){
    const local = normalizeLocalId(card);
    const setCodeLower = (card.setCodeLower || (card.id && card.id.split("-")[0].toLowerCase()) || "");
    if(local && setCodeLower) url = assetUrl(TCGDEX_LANG, setCodeLower, local, "low");
  }
  return ensureAssetUrl(url) || "";
}

/* ========== 7) NORMALISATION CARTE ========== */
function normalizeCardFromTCGdex(card, brief, setIndex){
  const raw = brief.codeRaw || brief.id || brief.code || "";
  const setCodeUpper = (brief.codeUpper || raw).toUpperCase();
  const setCodeLower = (brief.codeLower || raw).toLowerCase();
  const setName = brief.name || brief.nameFR || brief.nameEN || raw;
  const number  = normalizeLocalId(card);

  const typesCanon = Array.isArray(card.types) ? card.types.map(canonType).filter(Boolean) : [];
  const pr = parseRarity(card.rarity);

  return {
    id: card.id,
    name: card.name || "Unknown",
    rarityRaw: card.rarity || "",
    rarityKey: pr.key,
    rarityEmoji: pr.emoji,
    rarityWeight: pr.weight,
    types: typesCanon,
    set: setName,
    setCodeUpper,
    setCodeLower,
    setIndex,
    number,
    image: extractCardImageUrl({ ...card, setCodeLower })
  };
}

/* ========== 8) API (Pocket-only) ========== */
function isPocketSet(s){
  const code   = (s.id || s.code || '').toLowerCase();
  const series = (s.series?.id || s.series?.code || s.series || s.serie?.id || s.serie || '').toLowerCase();
  const sname  = (s.series?.name || s.serie?.name || '').toLowerCase();
  const bySeries = series === 'tcgp' || series.includes('pocket') || sname.includes('pocket');
  const byCode   = /^a\d+[a-z]*$/i.test(code);
  return bySeries || byCode;
}
async function fetchSetsMerged(){
  const fetchList = async L => {
    const r = await fetch(`${API_BASE}/${L}/sets`);
    if(!r.ok) throw new Error(`sets ${L}`);
    const arr = await r.json();
    return arr.filter(isPocketSet).map(s => ({
      codeLower: (s.id || s.code || '').toLowerCase(),
      codeUpper: (s.id || s.code || '').toUpperCase(),
      name: s.name || '',
      releaseDate: s.releaseDate || '',
      _lang: L
    }));
  };
  let fr=[], en=[]; try{fr=await fetchList('fr');}catch{} try{en=await fetchList('en');}catch{}
  const map=new Map(); for(const s of en) map.set(s.codeLower,{...s}); for(const s of fr) map.set(s.codeLower,{...(map.get(s.codeLower)||{}),...s});
  const list=[...map.values()].map(x=>({ codeLower:x.codeLower, codeUpper:x.codeUpper, name:x.name||x.codeUpper, releaseDate:x.releaseDate||'' }));
  list.sort((a,b)=> (b.releaseDate||"").localeCompare(a.releaseDate||"") || a.codeUpper.localeCompare(b.codeUpper));
  return list;
}
async function fetchSetBrief(codeUpper){
  try{ const r=await fetch(`${API_BASE}/${TCGDEX_LANG}/sets/${codeUpper}`); if(!r.ok) throw 0; return await r.json(); }
  catch{ const r2=await fetch(`${API_BASE}/${ALT_LANG}/sets/${codeUpper}`); if(!r2.ok) throw new Error(`Set ${codeUpper} (HTTP ${r2.status})`); return await r2.json(); }
}
async function fetchCardDetailSafe(cardId){
  try{ const r=await fetch(`${API_BASE}/${TCGDEX_LANG}/cards/${cardId}`); if(!r.ok) throw 0; return await r.json(); }
  catch{ const r2=await fetch(`${API_BASE}/${ALT_LANG}/cards/${cardId}`); if(!r2.ok) throw new Error(`Carte ${cardId} (HTTP ${r2.status})`); return await r2.json(); }
}
async function fetchCardsDetailsWithPool(ids, poolSize=POOL_SIZE_PER_SET){
  const results=new Array(ids.length); let i=0;
  async function worker(){ while(i<ids.length){ const idx=i++; const id=ids[idx];
    try{ results[idx]=await fetchCardDetailSafe(id); }
    catch(e){ console.warn("Card KO:",id,e); results[idx]=null; await new Promise(r=>setTimeout(r,120)); }
  }}
  await Promise.all(Array.from({length:Math.min(poolSize,ids.length)}, worker));
  return results.filter(Boolean);
}

/* ========== 9) RARETÉ ALT-LANG & CHARGEMENT SETS ========== */
const rarityCache = new Map();
async function fetchRarityFromAltLang(cardId){
  if (rarityCache.has(cardId)) return rarityCache.get(cardId);
  try{ const res=await fetch(`${API_BASE}/${ALT_LANG}/cards/${cardId}`); if(res.ok){ const data=await res.json(); const rar=data?.rarity||''; rarityCache.set(cardId,rar); return rar; } }
  catch(e){}
  rarityCache.set(cardId,''); return '';
}
function updateSetsPill(){ const loaded=cardsBySet.size; qs('#sets-pill').textContent = `${loaded}/${ALL_SETS.length} sets chargés`; }

async function ensureSetLoaded(codeLower, setIndex){
  const lower=codeLower.toLowerCase(), upper=codeLower.toUpperCase();
  if(cardsBySet.has(lower)) return cardsBySet.get(lower);
  setLoading(true, `Chargement du set ${upper}…`);
  const brief=await fetchSetBrief(upper);
  const ids=Array.isArray(brief.cards)?brief.cards.map(c=>c.id):[];
  const detailed=await fetchCardsDetailsWithPool(ids, POOL_SIZE_PER_SET);

  await Promise.all(detailed.map(async c=>{
    const idKey=(c.id||'').toLowerCase();
    if(RARITY_ID_OVERRIDES.has(idKey)){ c.rarity=RARITY_ID_OVERRIDES.get(idKey); return; }
    if(!c.rarity || String(c.rarity).trim()===''){ const alt=await fetchRarityFromAltLang(idKey); if(alt) c.rarity=alt; }
  }));

  const normalized=detailed.map(c=>normalizeCardFromTCGdex(c,{ id:upper, code:upper, codeUpper:upper, codeLower:lower, name:brief.name }, setIndex));
  normalized.sort((a,b)=>(a.number||"").localeCompare(b.number||""));
  cardsBySet.set(lower, normalized);
  ALL_CARDS.push(...normalized);
  ALL_CARDS.sort((a,b)=> a.setIndex - b.setIndex || (a.number||"").localeCompare(b.number||""));
  updateSetsPill(); setLoading(false); return normalized;
}
async function loadAllSets(){
  const jobs=ALL_SETS.map((s,idx)=>({lower:s.codeLower, idx}));
  let running=0,cursor=0; return new Promise(resolve=>{
    const kick=async()=>{ while(running<SET_FETCH_CONCURRENCY && cursor<jobs.length){
      const job=jobs[cursor++]; running++; setLoading(true, `Chargement sets Pocket… ${cursor}/${jobs.length}`);
      ensureSetLoaded(job.lower, job.idx).finally(()=>{ running--; if(cursor>=jobs.length && running===0){ setLoading(false); resolve(); } else kick(); });
    }}; kick();
  });
}

/* ========== 10) MULTI-SELECT COMPACT (UI) ========== */
function buildMultiSelect(selectId, hostId, { placeholder, getLabel }) {
  const sel = qs(selectId);
  const host = qs(hostId);
  if (!sel || !host) return;

  // structure
  if (!host.dataset.built) {
    host.innerHTML = `
      <div class="ms-control" role="button" aria-haspopup="listbox" aria-expanded="false">
        <div class="ms-summary">${placeholder}</div>
        <div class="ms-caret">▾</div>
      </div>
      <div class="ms-panel" role="listbox"></div>`;
    host.dataset.built = "1";
  }
  const control = host.querySelector('.ms-control');
  const summary = host.querySelector('.ms-summary');
  const panel   = host.querySelector('.ms-panel');

  // options -> checkboxes
  panel.innerHTML = '';
  Array.from(sel.options)
    .filter(o => o.value !== "")
    .forEach((opt, idx) => {
      const id = `${sel.id}-opt-${idx}`;
      const row = document.createElement('label');
      row.className = 'ms-option';
      row.innerHTML = `
        <input type="checkbox" id="${id}" value="${opt.value}" ${opt.selected?'checked':''} />
        <span>${getLabel(opt)}</span>`;
      panel.appendChild(row);
    });

  function refreshSummary(){
    const selected = Array.from(sel.selectedOptions).map(o => o.textContent.trim()).filter(Boolean);
    if (selected.length === 0) { summary.textContent = placeholder; return; }
    // badges (max 2) + +N
    summary.innerHTML = '';
    const max = 2;
    selected.slice(0, max).forEach(txt=>{
      const b = document.createElement('span'); b.className = 'ms-badge'; b.textContent = txt;
      summary.appendChild(b);
    });
    if (selected.length > max) {
      const more = document.createElement('span'); more.className = 'ms-badge';
      more.textContent = `+${selected.length - max}`;
      summary.appendChild(more);
    }
  }
  refreshSummary();

  // interactions
  control.onclick = (e)=>{
    e.stopPropagation();
    const opened = host.classList.toggle('open');
    control.setAttribute('aria-expanded', opened ? 'true' : 'false');
  };
  document.addEventListener('click', (e)=>{
    if (!host.contains(e.target)) {
      host.classList.remove('open');
      control.setAttribute('aria-expanded', 'false');
    }
  });

  panel.onchange = (e)=>{
    const cb = e.target.closest('input[type="checkbox"]'); if(!cb) return;
    // sync native select
    const opt = Array.from(sel.options).find(o=>o.value===cb.value);
    if (opt) opt.selected = cb.checked;
    sel.dispatchEvent(new Event('change', { bubbles:true }));
    refreshSummary();
  };
}

function rebuildMultiSelects(){
  buildMultiSelect('#filter-type',   '#ms-type',   {
    placeholder: '— Type —',
    getLabel: (opt)=> `${TYPE_EMOJI[opt.value]||'🧩'} ${opt.value}`
  });
  buildMultiSelect('#filter-rarity', '#ms-rarity', {
    placeholder: '— Rareté —',
    getLabel: (opt)=> opt.textContent || '—'   // emoji only
  });
}

/* ========== 11) FILTRES, TRI & RENDU ========== */
function computeFilters(cards){
  // Types (canonisés FR)
  const types = [...new Set(cards.flatMap(c=>c.types||[]))].sort((a,b)=>String(a).localeCompare(String(b),'fr'));
  qs('#filter-type').innerHTML =
    `<option value=""></option>` + // placeholder vide (non sélectionnable)
    types.map(t=>`<option value="${t}">${TYPE_EMOJI[t]||'🧩'} ${t}</option>`).join('');

  // Raretés (clé stable -> emoji) triées et emoji only
  const rarMap = new Map();
  cards.forEach(c => { if (c.rarityKey) rarMap.set(c.rarityKey, c.rarityEmoji || '—'); });
  const rarities = [...rarMap.entries()].sort((a,b) => rarityOrderKey(a[0]) - rarityOrderKey(b[0]));
  qs('#filter-rarity').innerHTML =
    `<option value=""></option>` +
    rarities.map(([key,emoji])=>`<option value="${key}">${emoji}</option>`).join('');

  // construire/mettre à jour l’UI compacts
  rebuildMultiSelects();
}

function updateSetsListUI(){
  const sel=qs('#filter-set');
  sel.innerHTML = `<option value="" selected>-- Tous les sets --</option>` +
    ALL_SETS.map(s=>`<option value="${s.codeLower}">${s.codeUpper} — ${s.name}</option>`).join('');
}

function applyFilters(){
  const q   = norm(qs('#search')?.value || '');
  const typesSel = getSelectedValues('#filter-type');      // OR
  const rarSel   = getSelectedValues('#filter-rarity');    // OR (keys)
  const setVal   = qs('#filter-set')?.value || '';
  const coll     = qs('#filter-collection')?.value || '';

  FILTERED = ALL_CARDS.filter(c=>{
    const buf=[c.name,c.set,(c.types||[]).join(' '),c.rarityRaw,c.id,c.number,c.setCodeUpper,c.setCodeLower]
      .filter(Boolean).map(norm).join(' ');
    const okQ   = !q || buf.includes(q);
    const okT   = !typesSel.length || (c.types||[]).some(t=>typesSel.includes(t));
    const okR   = !rarSel.length || rarSel.includes(c.rarityKey);
    const okSet = !setVal || c.setCodeLower === setVal;

    let okColl = true;
    const isW = userData.wishlist.includes(c.id);
    const isD = userData.doublons.includes(c.id);
    if (coll === 'wishlist') okColl = isW;
    else if (coll === 'doublons') okColl = isD;
    else if (coll === 'either') okColl = (isW || isD);

    return okQ && okT && okR && okSet && okColl;
  });

  // tri
  const sortMode = qs('#sort-by')?.value || 'setnum-desc';
  FILTERED.sort((a,b)=>{
    const numA = parseInt(a.number||'0',10), numB = parseInt(b.number||'0',10);
    const tA = (a.types?.[0]||'zzz'), tB = (b.types?.[0]||'zzz');
    const rA = a.rarityWeight||0, rB = b.rarityWeight||0;
    const wA = userData.wishlist.includes(a.id), wB = userData.wishlist.includes(b.id);
    const dA = userData.doublons.includes(a.id), dB = userData.doublons.includes(b.id);

    switch(sortMode){
      case 'num-asc':  return numA - numB || a.setIndex - b.setIndex;
      case 'num-desc': return numB - numA || a.setIndex - b.setIndex;
      case 'rarity-asc':  return rA - rB || a.setIndex - b.setIndex || numA - numB;
      case 'rarity-desc': return rB - rA || a.setIndex - b.setIndex || numA - numB;
      case 'type-az':  return String(tA).localeCompare(String(tB),'fr') || a.setIndex - b.setIndex || numA - numB;
      case 'type-za':  return String(tB).localeCompare(String(tA),'fr') || a.setIndex - b.setIndex || numA - numB;
      case 'setnum-asc':  return a.setIndex - b.setIndex || numA - numB;
      case 'wish-first':  return (wB - wA) || a.setIndex - b.setIndex || numA - numB;
      case 'dup-first':   return (dB - dA) || a.setIndex - b.setIndex || numA - numB;
      case 'setnum-desc':
      default: return b.setIndex - a.setIndex || numA - numB;
    }
  });

  qs('#count-pill').textContent = humanCount(FILTERED.length);
}

function renderGrid(){
  const grid = qs('#card-grid');
  grid.innerHTML = FILTERED.map(c=>{
    const name=c.name||'Unknown';
    const types=c.types||[];
    const rar=c.rarityEmoji||'—';
    const id=c.id;
    const number=c.number||'';
    const setLbl=`${c.setCodeUpper} — ${c.set}`;

    const img=c.image||"";
    const fbs=buildAssetFallbacks(c);
    const tip=`
      <div class="hover-info" role="tooltip" aria-label="${name}">
        <div style="font-weight:700; font-size:1rem; margin-bottom:2px;">${name}</div>
        <div class="badges">
          <span class="badge">${rar}</span>
          ${(types||[]).map(t=>`<span class="badge">${TYPE_EMOJI[t]||'🧩'} ${t}</span>`).join('')}
          <span class="badge">📦 ${setLbl} #${number}</span>
        </div>
      </div>`;
    return `
      <div class="poke-card" data-id="${id}">
        <div class="img-wrap" title="${name}">
          ${
            img
              ? `<img class="card-img" src="${img}" alt="${name}" loading="lazy"
                   data-fallback1="${fbs[0]||''}" data-fallback2="${fbs[1]||''}"
                   data-fallback3="${fbs[2]||''}" data-fallback4="${fbs[3]||''}"
                   data-fb-index="0">`
              : `<img class="card-img" src="${fbs[0]||''}" alt="${name}" loading="lazy"
                   data-fallback1="${fbs[1]||''}" data-fallback2="${fbs[2]||''}"
                   data-fallback3="${fbs[3]||''}" data-fb-index="0">`
          }
          ${tip}
        </div>
        <div class="card-actions">
          <button class="btn-dup ${userData.doublons.includes(id)?'active':''}" data-id="${id}">Doublons</button>
          <button class="btn-wish ${userData.wishlist.includes(id)?'active':''}" data-id="${id}">Wishlist</button>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('img.card-img').forEach(img=>{
    img.onerror = () => { const i=Number(img.dataset.fbIndex||0)+1; const next=img.dataset['fallback'+i];
      if(next){ img.dataset.fbIndex=String(i); img.src=next; } else { img.onerror=null; } };
  });

  grid.onclick = (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    const id=b.dataset.id;
    if (b.classList.contains('btn-dup')) {
      const has=userData.doublons.includes(id);
      userData.doublons = has ? userData.doublons.filter(x=>x!==id) : [...userData.doublons, id];
      b.classList.toggle('active', !has); saveUserData();
    } else if (b.classList.contains('btn-wish')) {
      const has=userData.wishlist.includes(id);
      userData.wishlist = has ? userData.wishlist.filter(x=>x!==id) : [...userData.wishlist, id];
      b.classList.toggle('active', !has); saveUserData();
    }
  };
}

/* ========== 12) INIT ========== */
document.addEventListener('DOMContentLoaded', async () => {
  const profileSelect=qs('#profile'); if(profileSelect) currentProfile=profileSelect.value; loadUserData();

  const banner=qs('#data-source-banner');
  if (banner) banner.innerHTML = `Mode données : <strong>${DATA_SOURCE.toUpperCase()}</strong> (lang: ${TCGDEX_LANG}) — Sets: Pocket (FR+EN fusion, tri par date)`;

  try{
    setLoading(true, "Récupération des sets Pocket…");
    ALL_SETS = await fetchSetsMerged();
    if(!ALL_SETS.length) throw new Error("Aucun set Pocket trouvé.");
    updateSetsListUI(); qs('#sets-pill').textContent = `0/${ALL_SETS.length} sets chargés`;

    await loadAllSets();
    computeFilters(ALL_CARDS); applyFilters(); renderGrid();
  }catch(e){ console.error(e); setLoading(true, "Erreur lors du chargement initial."); }
  finally{ setLoading(false); }

  // Écoutes
  const reRender = ()=>{ applyFilters(); renderGrid(); };
  ['#search','#filter-set','#filter-collection','#sort-by','#filter-type','#filter-rarity']
    .forEach(sel => { qs(sel)?.addEventListener('change', reRender); qs(sel)?.addEventListener('input', reRender); });

  // Debounce sur la recherche
  const deb=(fn,ms=200)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  qs('#search')?.addEventListener('input', deb(reRender, 200));

  qs('#btn-reset')?.addEventListener('click', ()=>{
    qs('#search').value=''; qs('#filter-set').value=''; qs('#filter-collection').value='';
    // vider les natifs
    Array.from(qs('#filter-type').options).forEach(o=>o.selected=false);
    Array.from(qs('#filter-rarity').options).forEach(o=>o.selected=false);
    qs('#sort-by').value='setnum-desc';
    // maj UI des dropdowns compacts
    rebuildMultiSelects();
    applyFilters(); renderGrid();
  });

  profileSelect?.addEventListener('change', ()=>{ currentProfile=profileSelect.value; loadUserData(); applyFilters(); renderGrid(); });
});
