/* ========== 1) CONFIG (inchangé côté HTML) ========== */
const API_BASE     = "https://api.tcgdex.net/v2";
let   TCGDEX_LANG  = "fr";
const ALT_LANG     = (TCGDEX_LANG === 'fr' ? 'en' : 'fr');
const IMG_QUALITY  = "low", IMG_EXT = "webp";

/* Réseau : on charge A1 en priorité, puis 2 sets en parallèle pour le reste */
const SET_FETCH_CONCURRENCY = 2;
const POOL_SIZE_PER_SET     = 6;   // nb de workers par set (détails cartes)

/* Overrides rareté si TCgdex est vide pour ces IDs */
const RARITY_ID_OVERRIDES = new Map([
  ['a1-265','2 star'],
  ['a1-279','2 star'],
]);

/* ========== 2) STATE GLOBAL ========== */
let ALL_SETS   = [];           // { codeLower, codeUpper, name, releaseDate }
let ALL_CARDS  = [];           // cartes normalisées (tous sets cumulés)
let FILTERED   = [];           // résultat après filtres/tri
const cardsBySet = new Map();  // codeLower -> [cards]

let currentProfile = "Pocho";
let userData = { wishlist: [], doublons: [] };

/* Fenêtrage simple (mêmes sensations qu’avant) */
const PAGE = 60;
const WINDOW_MAX = 240;
let windowStart = 0, windowEnd = PAGE;
let io = null;
let firstSetPainted = false;

/* ========== 3) HELPERS DOM & UI ========== */
const qs=(s,p=document)=>p.querySelector(s);
const norm=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
function setLoading(on, text){
  const el=qs('#loader'); if(!el) return;
  el.style.display = on ? 'block' : 'none';
  if (text) el.textContent = text;
}
const humanCount = n => `${n.toLocaleString('fr-FR')} ${n===1?'carte':'cartes'}`;
const getSelectedValues = sel => Array.from(qs(sel)?.selectedOptions || []).map(o=>o.value).filter(Boolean);

const getStorageKey=()=>`woenwData-v08-${currentProfile}`;
function loadUserData(){ const raw=localStorage.getItem(getStorageKey()); userData = raw?JSON.parse(raw):{wishlist:[],doublons:[]}; }
function saveUserData(){ localStorage.setItem(getStorageKey(), JSON.stringify(userData)); }

const debounce=(fn,ms=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
const softReRender = debounce(()=>{ applyFilters(); resetWindow(); renderGridWindowed(); }, 120);

function updatePills(){
  const countPill = qs('#count-pill');
  if (countPill) countPill.textContent = humanCount(FILTERED.length);
  const setsPill = qs('#sets-pill');
  if (setsPill) setsPill.textContent = `${cardsBySet.size}/${ALL_SETS.length} sets chargés`;
}

/* ========== 4) TYPES & RARETÉ (mêmes conventions) ========== */
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
  const n = Math.max(1, Math.min(countFromString(rr)||1, 4));
  if (rr.includes('chromatique') || rr.includes('shiny') || rr.includes('rainbow'))
    return { key:`shiny-${n}`,   emoji:'🌈'.repeat(n), weight:400+n };
  if (rr.includes('diamant') || rr.includes('diamond'))
    return { key:`diamond-${n}`, emoji:'💎'.repeat(n), weight:200+n };
  if (rr.includes('etoile') || rr.includes('étoile') || rr.includes('star'))
    return { key:`star-${n}`,    emoji:'⭐'.repeat(n), weight:300+n };
  if (rr.includes('sans') && rr.includes('rarete')) return { key:'none', emoji:'—', weight:0 };
  return { key: rr, emoji: r, weight:100 };
}
function rarityOrderKey(key){
  if (key === 'crown') return 999;
  const m = /^(\w+)-(\d)$/.exec(key); if(!m) return 500;
  const base = { diamond: 100, star: 200, shiny: 300 }[m[1]] ?? 800;
  return base + Number(m[2]||0);
}

/* ========== 5) IMAGES & NORMALISATION ========== */
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

function normalizeCardFromTCGdex(card, brief, setIndex){
  const setCodeUpper = (brief.codeUpper || brief.id || "").toUpperCase();
  const setCodeLower = (brief.codeLower || brief.id || "").toLowerCase();
  const setName = brief.name || brief.nameFR || brief.nameEN || brief.id || '';
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
    setCodeUpper, setCodeLower,
    setIndex,
    number,
    image: extractCardImageUrl({ ...card, setCodeLower })
  };
}

/* ========== 6) API (sets Pocket FR+EN) ========== */
function isPocketSet(s){
  const code   = (s.id || s.code || '').toLowerCase();
  const series = (s.series?.id || s.series?.code || s.series || s.serie?.id || s.serie || '').toLowerCase();
  const sname  = (s.series?.name || s.serie?.name || '').toLowerCase();
  return series === 'tcgp' || series.includes('pocket') || sname.includes('pocket') || /^a\d+[a-z]*$/.test(code);
}
async function fetchSetsMerged(){
  const fetchList = async L => {
    const r = await fetch(`${API_BASE}/${L}/sets`); if(!r.ok) throw new Error(`sets ${L}`);
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
  // Tri interne par date croissante (ancien → récent) pour que A1 soit naturellement devant
  list.sort((a,b)=> (a.releaseDate||"").localeCompare(b.releaseDate||"") || a.codeUpper.localeCompare(b.codeUpper));
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
const rarityCache = new Map();
async function fetchRarityFromAltLang(cardId){
  if (rarityCache.has(cardId)) return rarityCache.get(cardId);
  try{ const res=await fetch(`${API_BASE}/${ALT_LANG}/cards/${cardId}`); if(res.ok){ const data=await res.json(); const rar=data?.rarity||''; rarityCache.set(cardId,rar); return rar; } }
  catch(e){}
  rarityCache.set(cardId,''); return '';
}

/* ========== 7) CHARGEMENT PAR SET (progressif) ========== */
async function ensureSetLoaded(codeLower, setIndex){
  const lower=codeLower.toLowerCase(), upper=codeLower.toUpperCase();
  if(cardsBySet.has(lower)) return cardsBySet.get(lower);

  setLoading(true, `Chargement du set ${upper}…`);

  const brief=await fetchSetBrief(upper);
  const ids=Array.isArray(brief.cards)?brief.cards.map(c=>c.id):[];
  const detailed=await fetchCardsDetailsWithPool(ids, POOL_SIZE_PER_SET);

  // Corrections rareté manquante
  await Promise.all(detailed.map(async c=>{
    const idKey=(c.id||'').toLowerCase();
    if(RARITY_ID_OVERRIDES.has(idKey)){ c.rarity=RARITY_ID_OVERRIDES.get(idKey); return; }
    if(!c.rarity || String(c.rarity).trim()===''){ const alt=await fetchRarityFromAltLang(idKey); if(alt) c.rarity=alt; }
  }));

  const normalized=detailed.map(c=>normalizeCardFromTCGdex(c,{ id:upper, code:upper, codeUpper:upper, codeLower:lower, name:brief.name }, setIndex));
  normalized.sort((a,b)=>(a.number||"").localeCompare(b.number||""));
  cardsBySet.set(lower, normalized);

  // cumul + tri global par setIndex croissant (ancien→récent) puis # croissant
  ALL_CARDS.push(...normalized);
  ALL_CARDS.sort((a,b)=> a.setIndex - b.setIndex || (a.number||"").localeCompare(b.number||""));

  // Rendu progressif : premier set => on allume tout, ensuite rendu léger
  if (!firstSetPainted) {
    computeFilters(ALL_CARDS);
    // Tri par défaut en douceur (sans changer ton HTML)
    const sb=qs('#sort-by'); if(sb) sb.value='setnum-asc';
    applyFilters(); resetWindow(); renderGridWindowed();
    firstSetPainted = true;
  } else {
    softReRender();
  }

  updatePills();
  setLoading(false);
  return normalized;
}

/* Lance A1 d’abord, puis le reste en parallèle (2 en même temps) */
async function loadAllSetsProgressive(){
  // setIndex = position dans ALL_SETS trié ancien→récent
  // on force A1 devant si présent
  const a1Idx = ALL_SETS.findIndex(s=>s.codeLower==='a1');
  if (a1Idx >= 0) await ensureSetLoaded('a1', a1Idx);
  else if (ALL_SETS.length) await ensureSetLoaded(ALL_SETS[0].codeLower, 0);

  // reste des jobs
  const jobs = ALL_SETS
    .map((s,idx)=>({lower:s.codeLower, idx}))
    .filter(j => j.lower !== 'a1'); // A1 déjà fait (si existait)

  let running=0, cursor=0;
  return new Promise(resolve=>{
    const kick=async()=>{
      while(running<SET_FETCH_CONCURRENCY && cursor<jobs.length){
        const job=jobs[cursor++]; running++;
        setLoading(true, `Chargement sets… ${cursor}/${jobs.length}`);
        ensureSetLoaded(job.lower, job.idx).finally(()=>{
          running--;
          if(cursor>=jobs.length && running===0){ setLoading(false); resolve(); }
          else kick();
        });
      }
    };
    kick();
  });
}

/* ========== 8) MULTI-SELECT COMPACTS (respecte ton HTML/CSS) ========== */
function buildMultiSelect(selectId, hostId, { placeholder, getLabel }) {
  const sel = qs(selectId); const host = qs(hostId); if (!sel || !host) return;
  if (!host.dataset.built) {
    host.innerHTML = `
      <div class="ms-control" role="button" aria-haspopup="listbox" aria-expanded="false">
        <div class="ms-summary">${placeholder}</div>
        <div class="ms-caret">▾</div>
      </div>
      <div class="ms-panel" role="listbox"></div>`;
    host.classList.add('open-fix-off'); // rien, juste garder compat
    host.dataset.built = "1";
  }
  const control = host.querySelector('.ms-control');
  const summary = host.querySelector('.ms-summary');
  const panel   = host.querySelector('.ms-panel');

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
    const opt = Array.from(sel.options).find(o=>o.value===cb.value);
    if (opt) opt.selected = cb.checked;
    sel.dispatchEvent(new Event('change', { bubbles:true }));
    refreshSummary();
  };
}
function rebuildMultiSelects(){
  buildMultiSelect('#filter-type',   '#ms-type',   {
    placeholder: 'Type',
    getLabel: (opt)=> `${TYPE_EMOJI[opt.value]||'🧩'} ${opt.value}`
  });
  buildMultiSelect('#filter-rarity', '#ms-rarity', {
    placeholder: 'Rareté',
    getLabel: (opt)=> opt.textContent || '—'
  });
}

/* ========== 9) FILTRES & TRI (respecte ton UI) ========== */
function computeFilters(cards){
  const types = [...new Set(cards.flatMap(c=>c.types||[]))].sort((a,b)=>String(a).localeCompare(String(b),'fr'));
  const typeSel = qs('#filter-type');
  if (typeSel) {
    typeSel.innerHTML = `<option value=""></option>` + types.map(t=>`<option value="${t}">${TYPE_EMOJI[t]||'🧩'} ${t}</option>`).join('');
  }

  const rarMap = new Map();
  cards.forEach(c => { if (c.rarityKey) rarMap.set(c.rarityKey, c.rarityEmoji || '—'); });
  const rarities = [...rarMap.entries()].sort((a,b) => rarityOrderKey(a[0]) - rarityOrderKey(b[0]));
  const rarSel = qs('#filter-rarity');
  if (rarSel) {
    rarSel.innerHTML = `<option value=""></option>` + rarities.map(([key,emoji])=>`<option value="${key}">${emoji}</option>`).join('');
  }

  rebuildMultiSelects();
}
function applyFilters(){
  const q   = norm(qs('#search')?.value || '');
  const typesSel = getSelectedValues('#filter-type');
  const rarSel   = getSelectedValues('#filter-rarity');
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

  const sortMode = (qs('#sort-by')?.value || 'setnum-asc'); // défaut : ancien→récent
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
      case 'setnum-asc':  return a.setIndex - b.setIndex || numA - numB;   // défaut
      case 'wish-first':  return (wB - wA) || a.setIndex - b.setIndex || numA - numB;
      case 'dup-first':   return (dB - dA) || a.setIndex - b.setIndex || numA - numB;
      case 'setnum-desc':
      default: return b.setIndex - a.setIndex || numA - numB;
    }
  });

  updatePills();
}
function resetWindow(){ windowStart = 0; windowEnd = PAGE; }

/* ========== 10) RENDU (respecte ta structure + .hover-info) ========== */
function renderGridWindowed(){
  const grid = qs('#card-grid'); if(!grid) return;
  grid.innerHTML = '';

  const slice = FILTERED.slice(windowStart, Math.min(windowEnd, FILTERED.length));

  grid.innerHTML = slice.map(c=>{
    const name=c.name||'Unknown';
    const types=c.types||[];
    const rar=c.rarityEmoji||'—';
    const id=c.id;
    const number=c.number||'';
    const setLbl=`${c.setCodeUpper} — ${c.set}`;

    const img=c.image||"";
    const fbs=buildAssetFallbacks(c);

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
          <div class="hover-info">
            <div style="font-weight:700; font-size:1rem; margin-bottom:2px;">${name}</div>
            <div class="badges">
              <span class="badge">${rar}</span>
              ${(types||[]).map(t=>`<span class="badge">${TYPE_EMOJI[t]||'🧩'} ${t}</span>`).join('')}
              <span class="badge">📦 ${setLbl} #${number}</span>
            </div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-dup ${userData.doublons.includes(id)?'active':''}" data-id="${id}">Doublons</button>
          <button class="btn-wish ${userData.wishlist.includes(id)?'active':''}" data-id="${id}">Wishlist</button>
        </div>
      </div>`;
  }).join('');

  // Fallback chain pour images
  grid.querySelectorAll('img.card-img').forEach(img=>{
    img.onerror = () => {
      const i=Number(img.dataset.fbIndex||0)+1;
      const next=img.dataset['fallback'+i];
      if(next){ img.dataset.fbIndex=String(i); img.src=next; } else { img.onerror=null; }
    };
  });

  // Délégation clics
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

  setupSentinel();
}
function setupSentinel(){
  const grid = qs('#card-grid'); if(!grid) return;
  const old=qs('#sentinel'); if(old) old.remove();
  if (windowEnd >= FILTERED.length) return;

  const sentinel = document.createElement('div');
  sentinel.id='sentinel'; sentinel.style.height='1px'; sentinel.style.width='100%'; sentinel.style.margin='1px 0';
  grid.appendChild(sentinel);

  if(!io){
    io=new IntersectionObserver((entries)=>{
      const e=entries[0]; if(!e.isIntersecting) return;
      const nextEnd = Math.min(windowEnd + PAGE, FILTERED.length);
      const windowSize = nextEnd - windowStart;
      if (windowSize > WINDOW_MAX) windowStart += PAGE;
      windowEnd = nextEnd;
      io.unobserve(e.target);
      renderGridWindowed();
    }, { rootMargin:'300px' });
  }
  io.observe(sentinel);
}

/* ========== 11) INIT ==========
   — ne modifie pas ton HTML, rend juste tout progressif et interactif */
document.addEventListener('DOMContentLoaded', async () => {
  // profil & data
  const profileSelect=qs('#profile'); if(profileSelect) currentProfile=profileSelect.value;
  loadUserData();

  // bannière (si présente)
  const banner=qs('#data-source-banner');
  if (banner) banner.textContent = `Source : TCGdex (langue ${TCGDEX_LANG.toUpperCase()}) — Série Pocket`;

  // Tri par défaut (ancien → récent) SANS modifier ton HTML
  const sb=qs('#sort-by'); if(sb) sb.value='setnum-asc';

  // Listeners UI
  const reRender = ()=>{ applyFilters(); resetWindow(); renderGridWindowed(); };
  ['#search','#filter-set','#filter-collection','#sort-by','#filter-type','#filter-rarity']
    .forEach(sel => { qs(sel)?.addEventListener('input', reRender); qs(sel)?.addEventListener('change', reRender); });

  qs('#btn-reset')?.addEventListener('click', ()=>{
    const s=qs('#search'); if(s) s.value='';
    const fs=qs('#filter-set'); if(fs) fs.value='';
    const fc=qs('#filter-collection'); if(fc) fc.value='';
    Array.from(qs('#filter-type')?.options||[]).forEach(o=>o.selected=false);
    Array.from(qs('#filter-rarity')?.options||[]).forEach(o=>o.selected=false);
    if(sb) sb.value='setnum-asc';
    rebuildMultiSelects();
    reRender();
  });
  profileSelect?.addEventListener('change', ()=>{ currentProfile=profileSelect.value; loadUserData(); reRender(); });

  try{
    setLoading(true, "Récupération des sets Pocket…");
    ALL_SETS = await fetchSetsMerged();
    // construis la liste de sets dans ton select natif
    const sel=qs('#filter-set');
    if (sel) {
      sel.innerHTML = `<option value="">-- Tous les sets --</option>` +
        ALL_SETS.map(s=>`<option value="${s.codeLower}">${s.codeUpper} — ${s.name}</option>`).join('');
    }
    // Premier rendu : A1 d’abord, puis le reste (progressif, non bloquant)
    await loadAllSetsProgressive();
  }catch(e){
    console.error(e);
    setLoading(true, "Erreur lors du chargement initial.");
  }finally{
    // Éteindre la ligne loader si au moins un set a affiché des cartes
    if (firstSetPainted) setLoading(false);
  }

  // (Re)construit multi‑selects dès qu’on a le 1er set
  if (firstSetPainted) rebuildMultiSelects();
});
