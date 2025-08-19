/****************************************************
 * Woenw Trade — V0.7.2 (script.js)
 * - Données: "local" (cards.json) OU "tcgdex" (API TCGdex)
 * - UI: recherche, filtres, wishlist/doublons, multi-profils
 * - EXTRA: colonne "Image" + raretés → emojis
 * - PATCH: assets.tcgdex.net /tcgp/{set}/{localId}/{quality}.{ext}
 *          + auto-ajout de /low.webp si l’URL est “nue”
 ****************************************************/


/* ==============================
   1) CONFIG GLOBALE
   ============================== */

// Bascule de source ("local" | "tcgdex")
const DATA_SOURCE = "tcgdex";
window.DATA_SOURCE = DATA_SOURCE; // si ton HTML lit window.DATA_SOURCE

// TCGdex
const TCGDEX_LANG = "fr";      // "fr" | "en"
const TCGDEX_SET  = "A1";      // ex: "A1"
const MAX_CARDS   = 60;        // limite de cartes API (augmente si OK)
const POOL_SIZE   = 5;         // nombre de requêtes parallèles max

// Normalise une chaîne (supprime accents, minuscule)
const norm = s => (s || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();


/* ==============================
   2) PROFILS & LOCAL STORAGE
   ============================== */

let currentProfile = "Pocho";                  // profil actif
let userData = { wishlist: [], doublons: [] }; // état par profil

const getStorageKey = () => `woenwData-v07-${currentProfile}`;

function loadUserData() {
  const raw = localStorage.getItem(getStorageKey());
  userData = raw ? JSON.parse(raw) : { wishlist: [], doublons: [] };
}

function saveUserData() {
  localStorage.setItem(getStorageKey(), JSON.stringify(userData));
}


/* ==============================
   3) RARETÉS → EMOJIS
   ============================== */

// Déduit 1..4 à partir du libellé (FR/EN, chiffres/mots)
function countFromString(s) {
  const r = norm(s);
  if (r.includes("4") || r.includes("quatre") || r.includes("four"))  return 4;
  if (r.includes("3") || r.includes("trois")  || r.includes("three")) return 3;
  if (r.includes("2") || r.includes("deux")   || r.includes("two"))   return 2;
  if (r.includes("1") || r.includes("une")    || r.includes("un") || r.includes("one")) return 1;
  return null;
}

// Convertit texte rareté → emoji(s)
function rarityToEmoji(rarity) {
  if (!rarity) return "—";
  const r = norm(rarity);

  // "Sans Rareté"
  if (r.includes("sans") && r.includes("rarete")) return "—";

  // Couronne
  if (r.includes("couronne") || r.includes("crown")) return "👑";

  // Diamants
  if (r.includes("diamant") || r.includes("diamond")) {
    const n = countFromString(r) || 1;
    return "💎".repeat(Math.max(1, Math.min(n, 4)));
  }

  // Étoiles
  if (r.includes("etoile") || r.includes("étoile") || r.includes("star")) {
    const n = countFromString(r) || 1;
    return "⭐".repeat(Math.max(1, Math.min(n, 4)));
  }

  // Par défaut (non reconnu)
  return rarity;
}


/* ==============================
   4) HELPERS IMAGE (robustes)
   ============================== */

// --- Renvoie la 1ère URL ressemblant à une image (profondeur illimitée)
function findFirstImageUrl(obj) {
  let found = null;
  const isImg = v => {
    if (typeof v !== "string") return false;
    // accepte http(s) ET protocol-relative // ; extensions usuelles
    return /^(https?:)?\/\/.+\.(png|jpe?g|webp|svg|avif|gif)(\?.*)?$/i.test(v);
  };
  (function walk(o) {
    if (!o || found) return;
    if (isImg(o)) { found = o; return; }
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (typeof o === "object") { for (const k in o) walk(o[k]); }
  })(obj);
  if (found && found.startsWith("//")) found = "https:" + found; // normalise
  return found;
}

// --- Normalise localId en "001"
function normalizeLocalId(card) {
  const raw = card?.localId || (card?.id?.includes("-") ? card.id.split("-")[1] : "");
  return raw ? String(raw).padStart(3, "0") : "";
}

// --- Si l'URL assets finit sans extension (ex: .../A1/001), on ajoute /low.webp
function ensureAssetUrl(u) {
  if (!u) return "";
  let s = String(u);
  if (s.startsWith("//")) s = "https:" + s;

  const looksLikeAsset = /^https?:\/\/assets\.tcgdex\.net\/[^?#]+$/i.test(s);
  const hasExt = /\.(png|jpe?g|webp)(\?.*)?$/i.test(s);

  if (looksLikeAsset && !hasExt) {
    s = s.replace(/\/?$/, "/low.webp"); // doc TCGdex: {quality}.{extension}
  }
  return s;
}

// --- Construit une URL d'asset connue si l'API ne donne rien (TCG Pocket = /tcgp/)
function buildTCGdexImageUrlFallback(card, lang = TCGDEX_LANG, setCode = TCGDEX_SET) {
  const local = normalizeLocalId(card);
  if (!local) return "";
  // confirmé en tests: low.webp/high.webp répondent 200 sur /tcgp/
  return `https://assets.tcgdex.net/${lang}/tcgp/${setCode}/${local}/low.webp`;
}

// --- Essaie chemins connus → deep scan → fallback construit (+ ensureAssetUrl)
function extractCardImageUrl(card) {
  const direct =
    (typeof card.image === "string" ? card.image : null) ||
    card.image?.small || card.image?.low || card.image?.thumbnail ||
    card.images?.small || card.images?.low || card.images?.thumbnail ||
    card.illustration?.small || card.illustration?.low ||
    card.picture || card.sprite || card.thumbnail || null;

  let url = direct || findFirstImageUrl(card) || "";

  if (url && url.startsWith("//")) url = "https:" + url;

  if (!url && (card?.localId || card?.id)) {
    url = buildTCGdexImageUrlFallback(card);
  }

  return ensureAssetUrl(url) || "";
}


/* ==============================
   5) MAPPING (API → format interne)
   ============================== */

function normalizeCardFromTCGdex(card, setName) {
  const derivedNumber = normalizeLocalId(card);

  return {
    id: card.id,                                        // ex: "A1-001"
    name: card.name || "Sans nom",                      // FR/EN
    rarity: rarityToEmoji(card.rarity),                 // 💎 / ⭐ / 👑 / —
    types: Array.isArray(card.types) ? card.types : [],
    set: setName || TCGDEX_SET,                         // nom set lisible
    number: derivedNumber,                              // "001"
    image: extractCardImageUrl(card)                    // URL vignette
  };
}


/* ==============================
   6) API TCGdex
   ============================== */

async function fetchSetBrief(setCode, lang = TCGDEX_LANG) {
  const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets/${setCode}`);
  if (!res.ok) throw new Error(`Set ${setCode} (HTTP ${res.status})`);
  return res.json();
}

async function fetchCardDetail(cardId, lang = TCGDEX_LANG) {
  const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/${cardId}`);
  if (!res.ok) throw new Error(`Carte ${cardId} (HTTP ${res.status})`);
  return res.json();
}

async function fetchCardsDetailsWithPool(ids, poolSize = POOL_SIZE) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < ids.length) {
      const idx = i++;
      const id  = ids[idx];
      try {
        const card = await fetchCardDetail(id);
        results[idx] = card;            // conserve l'ordre
      } catch (err) {
        console.warn("TCGdex KO:", id, err);
        results[idx] = null;
        await new Promise(r => setTimeout(r, 120)); // petit backoff
      }
    }
  }

  const workers = Array.from({ length: Math.min(poolSize, ids.length) }, worker);
  await Promise.all(workers);
  return results.filter(Boolean);
}


/* ==============================
   7) CHARGER LES CARTES
   ============================== */

async function loadCards() {
  try {
    if (DATA_SOURCE === "tcgdex") {
      // 1) Set → IDs
      const setObj  = await fetchSetBrief(TCGDEX_SET);
      const setName = setObj?.name || TCGDEX_SET;
      const ids     = Array.isArray(setObj.cards) ? setObj.cards.map(c => c.id) : [];

      // 2) Limite configurable
      const limited = ids.slice(0, MAX_CARDS);

      // 3) Détails + normalisation
      const detailed = await fetchCardsDetailsWithPool(limited, POOL_SIZE);

      // DEBUG : pourquoi pas d’images ?
      const noImg = detailed.filter(c => !extractCardImageUrl(c)).slice(0, 5);
      if (noImg.length) {
        console.debug("[DEBUG] Cartes sans image (sample):",
          noImg.map(c => ({ id: c.id, localId: c.localId, keys: Object.keys(c) })));
      }

      return detailed.map(c => normalizeCardFromTCGdex(c, setName));
    }

    // Mode LOCAL (fallback ou DATA_SOURCE="local")
    const res = await fetch("cards.json");
    let cards = await res.json();
    // Harmonisation locale
    cards = cards.map(c => ({
      ...c,
      id: c.id || c.name,
      types: Array.isArray(c.types) ? c.types : (c.type ? [c.type] : []),
      rarity: rarityToEmoji(c.rarity || c.rarityText || c.r), // converti aussi en local
      image: extractCardImageUrl(c)                           // extraction robuste en local aussi
    }));
    return cards;

  } catch (err) {
    console.error("Erreur loadCards:", err);
    // Fallback dur → local
    try {
      const res = await fetch("cards.json");
      return await res.json();
    } catch {
      return [];
    }
  }
}


/* ==============================
   8) RENDU TABLEAU (avec colonne image)
   ============================== */

async function render() {
  const tbody = document.getElementById("cards-body");
  if (!tbody) return;

  const cards = await loadCards();

  const rows = cards.map(c => `
    <tr>
      <!-- Colonne 0 : Image -->
      <td>
        ${c.image
          ? `<a href="${c.image}" target="_blank" rel="noopener">
               <img src="${c.image}" alt="${c.name}" class="card-thumb" loading="lazy"
                    referrerpolicy="no-referrer" crossorigin="anonymous"
                    onerror="this.closest('td').innerHTML='—';">
             </a>`
          : "—"}
      </td>
      <!-- Colonne 1 : Nom -->
      <td>${c.name}</td>
      <!-- Colonne 2 : Type(s) -->
      <td>${(c.types || []).join(", ")}</td>
      <!-- Colonne 3 : Rareté (emoji) -->
      <td>${c.rarity}</td>
      <!-- Colonne 4 : Extension -->
      <td>${c.set}</td>
      <!-- Colonne 5 : Actions -->
      <td>
        <button class="wishlist-btn" data-id="${c.id}">Wishlist</button>
        <button class="doublon-btn" data-id="${c.id}">Doublon</button>
      </td>
    </tr>
  `).join("");

  tbody.innerHTML = rows;

  // Branchements UI
  populateFilters(cards);
  attachButtonHandlers();
  applyAllFilters();
  restoreButtonStates();
}


/* ==============================
   9) FILTRES + RECHERCHE
   ============================== */

// Remplit les <select> (Types / Rareté / Extension)
function populateFilters(cards) {
  const typeSelect   = document.getElementById('filter-type');
  const raritySelect = document.getElementById('filter-rarity');
  const setSelect    = document.getElementById('filter-set');

  // reset options
  [typeSelect, raritySelect, setSelect].forEach(sel => {
    if (sel) sel.innerHTML = '<option value="">-- Tous / Toutes --</option>';
  });

  const uniq = arr => [...new Set(arr)].sort();

  const types    = uniq(cards.flatMap(c => c.types || []));
  const rarities = uniq(cards.map(c => c.rarity).filter(Boolean));
  const sets     = uniq(cards.map(c => c.set).filter(Boolean));

  types.forEach(t => {
    const opt = document.createElement('option'); opt.value = t; opt.textContent = t;
    typeSelect?.appendChild(opt);
  });
  rarities.forEach(r => {
    const opt = document.createElement('option'); opt.value = r; opt.textContent = r;
    raritySelect?.appendChild(opt);
  });
  sets.forEach(s => {
    const opt = document.createElement('option'); opt.value = s; opt.textContent = s;
    setSelect?.appendChild(opt);
  });
}

// Important : les index de colonnes ont changé (image insérée en 0)
function applyAllFilters() {
  const q         = norm(document.getElementById('search')?.value || '');
  const typeVal   = document.getElementById('filter-type')?.value || '';
  const rarityVal = document.getElementById('filter-rarity')?.value || '';
  const setVal    = document.getElementById('filter-set')?.value || '';

  const rows = document.querySelectorAll('#cards-body tr');
  rows.forEach(tr => {
    const nameTxt   = norm(tr.cells?.[1]?.textContent || ''); // Nom = col 1
    const typesTxt  = tr.cells?.[2]?.textContent || '';       // Types = col 2
    const rarityTxt = tr.cells?.[3]?.textContent || '';       // Rareté = col 3 (emoji)
    const setTxt    = tr.cells?.[4]?.textContent || '';       // Set = col 4

    const matchSearch = nameTxt.includes(q);
    const matchType   = !typeVal || typesTxt.split(',').map(s => s.trim()).includes(typeVal);
    const matchRarity = !rarityVal || rarityTxt === rarityVal; // emoji exact
    const matchSet    = !setVal || setTxt === setVal;

    tr.style.display = (matchSearch && matchType && matchRarity && matchSet) ? '' : 'none';
  });
}


/* ==============================
   10) WISHLIST / DOUBLONS
   ============================== */

function attachButtonHandlers() {
  document.querySelectorAll('.wishlist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (userData.wishlist.includes(id)) {
        userData.wishlist = userData.wishlist.filter(x => x !== id);
        btn.classList.remove('active');
      } else {
        userData.wishlist.push(id);
        btn.classList.add('active');
      }
      saveUserData();
    });
  });

  document.querySelectorAll('.doublon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (userData.doublons.includes(id)) {
        userData.doublons = userData.doublons.filter(x => x !== id);
        btn.classList.remove('active');
      } else {
        userData.doublons.push(id);
        btn.classList.add('active');
      }
      saveUserData();
    });
  });
}

function restoreButtonStates() {
  userData.wishlist.forEach(id => {
    document.querySelector(`.wishlist-btn[data-id="${id}"]`)?.classList.add('active');
  });
  userData.doublons.forEach(id => {
    document.querySelector(`.doublon-btn[data-id="${id}"]`)?.classList.add('active');
  });
}

function clearButtonStates() {
  document.querySelectorAll('.wishlist-btn, .doublon-btn')
    .forEach(btn => btn.classList.remove('active'));
}


/* ==============================
   11) INIT DOM
   ============================== */

document.addEventListener("DOMContentLoaded", () => {
  // Profil initial
  const profileSelect = document.getElementById('profile');
  if (profileSelect) currentProfile = profileSelect.value;
  loadUserData();

  // Bandeau source (si présent dans le HTML)
  const banner = document.getElementById('data-source-banner');
  if (banner) banner.innerHTML = `Mode données : <strong>${DATA_SOURCE}</strong>`;

  // Rendu initial
  render();

  // Écouteurs filtres/recherche
  document.getElementById('search')?.addEventListener('input', applyAllFilters);
  document.getElementById('filter-type')?.addEventListener('change', applyAllFilters);
  document.getElementById('filter-rarity')?.addEventListener('change', applyAllFilters);
  document.getElementById('filter-set')?.addEventListener('change', applyAllFilters);

  // Changement de profil
  if (profileSelect) {
    profileSelect.addEventListener('change', () => {
      currentProfile = profileSelect.value;
      loadUserData();
      clearButtonStates();
      restoreButtonStates();
    });
  }
});
