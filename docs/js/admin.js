const TOKEN_KEY = "moving_sale_admin_token";
const CATEGORIES = ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "sports", "pet", "other"];
const CONDITIONS = ["new", "like_new", "good", "fair", "worn"];
// Midpoints of the same condition discount bands the AI uses when drafting a
// listing (see worker.js), so nudging the condition here moves the price the
// same direction/magnitude the AI would have priced it at for that condition.
const CONDITION_MULTIPLIER = { new: 0.925, like_new: 0.775, good: 0.625, fair: 0.475, worn: 0.325 };
const CATEGORY_ICONS = {
  furniture: "🛋️",
  appliances: "🔌",
  electronics: "💻",
  kitchenware: "🍳",
  decor: "🖼️",
  clothing: "👕",
  books: "📚",
  outdoor: "🌳",
  sports: "⚽",
  pet: "🐾",
  other: "📦",
};
const CATEGORY_LABELS = {
  furniture: "Furniture / Muebles",
  appliances: "Appliances / Electrodomésticos",
  electronics: "Electronics / Electrónica",
  kitchenware: "Kitchenware / Menaje de cocina",
  decor: "Decor / Decoración",
  clothing: "Clothing / Ropa",
  books: "Books / Libros",
  outdoor: "Outdoor / Exterior",
  sports: "Sports / Deportes",
  pet: "Pet / Mascotas",
  other: "Other / Otro",
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function authHeaders() {
  return { "Authorization": `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

async function unlock() {
  const input = document.getElementById("tokenInput").value.trim();
  if (!input) return;
  localStorage.setItem(TOKEN_KEY, input);

  const resp = await fetch(`${WORKER_BASE_URL}/api/admin/drafts`, { headers: authHeaders() });
  if (resp.status === 401) {
    alert("That token was rejected.");
    localStorage.removeItem(TOKEN_KEY);
    return;
  }

  document.getElementById("gate").style.display = "none";
  document.getElementById("adminBody").style.display = "block";
  loadAll();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function selectOptions(options, selected, labels) {
  return options.map((o) => `<option value="${o}" ${o === selected ? "selected" : ""}>${labels ? labels[o] : o}</option>`).join("");
}

function titleEn(l) { return l.title_en || l.title || ""; }
function titleEs(l) { return l.title_es || l.title || l.title_en || ""; }
function descEn(l) { return l.description_en || l.description || ""; }
function descEs(l) { return l.description_es || l.description || l.description_en || ""; }
function invOf(l) { return l.inventory || 1; }
function imagesOf(l) { return l.image_keys && l.image_keys.length ? l.image_keys : (l.image_key ? [l.image_key] : []); }

let allDrafts = [];
let allPublished = [];
let currentFxRate = 4000;

function currentFxRateValue() {
  const el = document.getElementById("fxRate");
  const v = el ? parseFloat(el.value) : NaN;
  return v > 0 ? v : currentFxRate;
}

function fmtUsdPreview(cop) {
  const usd = Math.round((cop / currentFxRateValue()) * 100) / 100;
  return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD`;
}

function updatePricePreview(inputEl) {
  const cop = parseInt(inputEl.value) || 0;
  const preview = inputEl.parentElement.querySelector(".price-usd-preview");
  if (preview) preview.textContent = fmtUsdPreview(cop);
}

function adjustPriceForCondition(selectEl) {
  const prevCondition = selectEl.dataset.prevCondition;
  const newCondition = selectEl.value;
  if (prevCondition && prevCondition !== newCondition) {
    const card = selectEl.closest(".admin-item");
    const priceInput = card.querySelector(".f-price-max");
    const ratio = CONDITION_MULTIPLIER[newCondition] / CONDITION_MULTIPLIER[prevCondition];
    const current = parseInt(priceInput.value) || 0;
    priceInput.value = Math.round((current * ratio) / 1000) * 1000;
    updatePricePreview(priceInput);
  }
  selectEl.dataset.prevCondition = newCondition;
}

function refreshAllPricePreviews() {
  document.querySelectorAll(".f-price-max").forEach((input) => updatePricePreview(input));
}

// Published listings default to read-only view mode; ids in here are being edited.
// Drafts always render in edit mode (they need review before going live).
const editingPublished = new Set();
const justSaved = new Set();

function modeBadge(mode) {
  if (mode === "editing") return `<span class="mode-badge editing">✏️ Editing</span>`;
  if (mode === "draft") return `<span class="mode-badge draft">✏️ Draft — needs review</span>`;
  return `<span class="mode-badge live">🟢 Live</span>`;
}

function duplicateBadge(l) {
  const dups = l.possible_duplicate_of || [];
  if (!dups.length) return "";
  const count = dups.length > 1 ? ` (${dups.length})` : "";
  return `<span class="dup-badge" onclick="focusListing('${dups[0]}')" title="Possible duplicate of another listing — click to jump to it">⚠️ Possible duplicate${count}</span>`;
}

function focusListing(id) {
  const el = document.querySelector(`.admin-item[data-id="${id}"]`);
  if (!el) {
    alert("The matching listing isn't in the current view — it may have already been handled or deleted.");
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("dup-flash");
  setTimeout(() => el.classList.remove("dup-flash"), 2000);
}

function editableFields(l) {
  return `
    <div><label>Title (English)</label><input class="f-title-en" value="${escapeHtml(titleEn(l))}"></div>
    <div><label>Título (Español)</label><input class="f-title-es" value="${escapeHtml(titleEs(l))}"></div>
    <div><label>Description (English)</label><textarea class="f-description-en">${escapeHtml(descEn(l))}</textarea></div>
    <div><label>Descripción (Español)</label><textarea class="f-description-es">${escapeHtml(descEs(l))}</textarea></div>
    <div class="row">
      <div><label>Category</label><select class="f-category">${selectOptions(CATEGORIES, l.category, CATEGORY_LABELS)}</select></div>
      <div><label>Condition</label><select class="f-condition" data-prev-condition="${l.condition}" onchange="adjustPriceForCondition(this)">${selectOptions(CONDITIONS, l.condition)}</select></div>
    </div>
    <div class="row">
      <div>
        <label>Suggested offer (COP) — shown to buyers as "or best offer"</label>
        <input class="f-price-max" type="number" value="${l.price_cop_max}" oninput="updatePricePreview(this)">
        <div class="price-usd-preview">${fmtUsdPreview(l.price_cop_max)}</div>
      </div>
      <div><label>Inventory (how many available)</label><input class="f-inventory" type="number" min="0" value="${invOf(l)}"></div>
    </div>
  `;
}

function readOnlyFields(l) {
  return `
    <div><strong>${escapeHtml(titleEn(l))}</strong> / <em>${escapeHtml(titleEs(l))}</em></div>
    <div>${escapeHtml(descEn(l))}</div>
    <div><em>${escapeHtml(descEs(l))}</em></div>
    <div>${CATEGORY_LABELS[l.category] || l.category} · ${l.condition} · ${invOf(l)} available</div>
    <div>Suggested offer: ${l.price_cop_max.toLocaleString()} COP (${fmtUsdPreview(l.price_cop_max)}), or best offer</div>
    ${l.status === "sold" && l.sold_price_cop != null ? `<div><strong>Sold for / Vendido por: ${l.sold_price_cop.toLocaleString()} COP</strong></div>` : ""}
    ${l.price_new_cop ? `<div class="ai-price-note">AI reasoning: new ≈ ${l.price_new_cop.toLocaleString()} COP → floor ${l.price_cop_min.toLocaleString()} / offer ${l.price_cop_max.toLocaleString()}</div>` : ""}
  `;
}

function savedFlash(id) {
  return justSaved.has(id) ? `<div class="saved-flash">✓ Saved</div>` : "";
}

function photoStrip(l) {
  const imgs = imagesOf(l);
  const thumbs = imgs.length > 1 ? imgs.map((imgId, i) => `
    <div class="photo-thumb">
      <img src="${WORKER_BASE_URL}/images/${imgId}" alt="">
      <button onclick="removePhoto('${l.id}', ${i})" title="Remove this photo / Quitar esta foto">✕</button>
    </div>
  `).join("") : "";
  return `
    <div class="photo-strip">
      ${thumbs}
      <label class="add-photo-btn" title="Add photo / Agregar foto">
        +
        <input type="file" accept="image/*" onchange="addPhoto('${l.id}', this.files[0])">
      </label>
    </div>
  `;
}

async function addPhoto(id, file) {
  if (!file) return;
  await fetch(`${WORKER_BASE_URL}/api/admin/listings/${id}/photos`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${getToken()}`, "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  loadAll();
}

function draftCard(l) {
  return `
    <div class="admin-item" data-id="${l.id}">
      <img src="${WORKER_BASE_URL}/images/${imagesOf(l)[0]}" alt="">
      <div class="admin-fields">
        ${modeBadge("draft")}
        ${duplicateBadge(l)}
        ${savedFlash(l.id)}
        ${l.price_new_cop ? `<div class="ai-price-note">AI reasoning: new ≈ ${l.price_new_cop.toLocaleString()} COP → floor ${l.price_cop_min.toLocaleString()} / offer ${l.price_cop_max.toLocaleString()}</div>` : ""}
        ${photoStrip(l)}
        ${editableFields(l)}
        <div class="admin-actions">
          <button onclick="publishDraft('${l.id}')">Publish</button>
          <button class="secondary" onclick="saveEdits('${l.id}', false)">Save edits</button>
          <button class="secondary redraft-btn" onclick="redraftListing('${l.id}')">✨ Fix with AI</button>
          ${imagesOf(l).length > 1 ? `<button class="secondary split-btn" onclick="splitListing('${l.id}')">Split into separate items (${imagesOf(l).length})</button>` : ""}
          <button class="danger" onclick="deleteListing('${l.id}')">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function publishedCard(l) {
  const editing = editingPublished.has(l.id);
  return `
    <div class="admin-item ${editing ? "is-editing" : ""}" data-id="${l.id}">
      <img src="${WORKER_BASE_URL}/images/${imagesOf(l)[0]}" alt="">
      <div class="admin-fields">
        <span class="badge ${l.status === "sold" ? "sold" : ""}">${l.status}</span>
        ${modeBadge(editing ? "editing" : "live")}
        ${duplicateBadge(l)}
        ${savedFlash(l.id)}
        ${photoStrip(l)}
        ${editing ? editableFields(l) : readOnlyFields(l)}
        <div class="admin-actions">
          ${editing ? `
            <button onclick="saveEdits('${l.id}', true)">Save</button>
            <button class="secondary" onclick="cancelEdit('${l.id}')">Cancel</button>
          ` : `
            <button class="secondary" onclick="enterEdit('${l.id}')">Edit</button>
            <button class="secondary redraft-btn" onclick="redraftListing('${l.id}')">✨ Fix with AI</button>
          `}
          ${l.status !== "sold" ? `<button class="secondary" onclick="markSold('${l.id}')">Mark sold</button>` : `<button class="secondary" onclick="markAvailable('${l.id}')">Mark available</button>`}
          <button class="danger" onclick="deleteListing('${l.id}')">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function enterEdit(id) {
  editingPublished.add(id);
  loadAll();
}

function cancelEdit(id) {
  editingPublished.delete(id);
  loadAll();
}

function readFields(id) {
  const card = document.querySelector(`.admin-item[data-id="${id}"]`);
  return {
    title_en: card.querySelector(".f-title-en").value.trim(),
    title_es: card.querySelector(".f-title-es").value.trim(),
    description_en: card.querySelector(".f-description-en").value.trim(),
    description_es: card.querySelector(".f-description-es").value.trim(),
    category: card.querySelector(".f-category").value,
    condition: card.querySelector(".f-condition").value,
    price_cop_max: parseInt(card.querySelector(".f-price-max").value) || 0,
    inventory: parseInt(card.querySelector(".f-inventory").value) || 0,
  };
}

async function patchListing(id, updates) {
  const resp = await fetch(`${WORKER_BASE_URL}/api/admin/listings/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  return resp.json();
}

async function saveEdits(id, exitEditMode) {
  await patchListing(id, readFields(id));
  if (exitEditMode) editingPublished.delete(id);
  justSaved.add(id);
  loadAll();
  setTimeout(() => { justSaved.delete(id); loadAll(); }, 1500);
}

async function publishDraft(id) {
  await patchListing(id, { ...readFields(id), status: "published" });
  loadAll();
}

async function markSold(id) {
  const listing = allPublished.find((l) => l.id === id) || allDrafts.find((l) => l.id === id);
  const suggested = listing ? listing.price_cop_max : 0;
  const input = prompt(`What did this actually sell for (COP)? / ¿Por cuánto se vendió realmente (COP)?`, suggested);
  if (input === null) return;
  const soldPrice = parseInt(input.replace(/[^\d]/g, "")) || 0;
  await patchListing(id, { status: "sold", sold_price_cop: soldPrice });
  loadAll();
}

async function markAvailable(id) {
  await patchListing(id, { status: "published" });
  loadAll();
}

async function deleteListing(id) {
  if (!confirm("Delete this listing permanently?")) return;
  await fetch(`${WORKER_BASE_URL}/api/admin/listings/${id}`, { method: "DELETE", headers: authHeaders() });
  loadAll();
}

async function removePhoto(id, index) {
  if (!confirm("Remove this photo from the listing? / ¿Quitar esta foto del anuncio?")) return;
  const listing = allDrafts.find((l) => l.id === id) || allPublished.find((l) => l.id === id);
  if (!listing) return;
  const imgs = imagesOf(listing).slice();
  imgs.splice(index, 1);
  await patchListing(id, { image_keys: imgs });
  loadAll();
}

async function redraftListing(id) {
  const note = prompt(
    "What's wrong with this listing? Tell the AI what to fix and it'll re-draft from the photo.\n\n" +
    "e.g. \"this is a chair, not a table\" · \"it's actually brand new, price higher\" · \"wrong category, it's electronics\" · \"describe the scratch on the lid\""
  );
  if (!note || !note.trim()) return;

  const card = document.querySelector(`.admin-item[data-id="${id}"]`);
  const btn = card ? card.querySelector(".redraft-btn") : null;
  if (btn) { btn.disabled = true; btn.textContent = "✨ Re-drafting…"; }

  const resp = await fetch(`${WORKER_BASE_URL}/api/admin/listings/${id}/redraft`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ note: note.trim() }),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.json()).error || ""; } catch (e) {}
    alert(`Re-draft failed. ${detail}`.trim());
    if (btn) { btn.disabled = false; btn.textContent = "✨ Fix with AI"; }
    return;
  }

  justSaved.add(id);
  loadAll();
  setTimeout(() => { justSaved.delete(id); loadAll(); }, 1500);
}

async function splitListing(id) {
  const listing = allDrafts.find((l) => l.id === id) || allPublished.find((l) => l.id === id);
  if (!listing) return;
  const imgs = imagesOf(listing);
  if (imgs.length < 2) return;
  if (!confirm(`Split this listing's ${imgs.length} photos into ${imgs.length} separate drafts? Each photo becomes its own AI-drafted listing. / ¿Separar en ${imgs.length} anuncios independientes?`)) return;

  const card = document.querySelector(`.admin-item[data-id="${id}"]`);
  const btn = card ? card.querySelector(".split-btn") : null;
  if (btn) btn.disabled = true;

  // One request per photo keeps each call small (well under the Worker subrequest limit
  // for a big batch). The original is left untouched until every photo has been extracted.
  for (let i = 0; i < imgs.length; i++) {
    if (btn) btn.textContent = `Splitting ${i + 1}/${imgs.length}…`;
    const resp = await fetch(`${WORKER_BASE_URL}/api/admin/split-photo`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ listing_id: id, image_key: imgs[i] }),
    });
    if (!resp.ok) {
      alert(`Split failed on photo ${i + 1} of ${imgs.length}. Stopping — the original listing is untouched, though ${i} new draft(s) were already created.`);
      if (btn) { btn.disabled = false; btn.textContent = `Split into separate items (${imgs.length})`; }
      loadAll();
      return;
    }
  }

  // Detach the (now shared) images from the original before deleting it, so the delete
  // doesn't remove image bytes the new drafts point at. Then remove the empty original.
  await patchListing(id, { image_keys: [] });
  await fetch(`${WORKER_BASE_URL}/api/admin/listings/${id}`, { method: "DELETE", headers: authHeaders() });
  loadAll();
}

async function rescanDuplicates() {
  const btn = document.getElementById("rescanDupesBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Scanning…"; }
  try {
    const resp = await fetch(`${WORKER_BASE_URL}/api/admin/rescan-duplicates`, { method: "POST", headers: authHeaders() });
    if (!resp.ok) throw new Error("bad status");
    const data = await resp.json();
    await loadAll();
    const n = (data.groups || []).length;
    alert(n ? `Found ${n} possible duplicate group${n > 1 ? "s" : ""}, flagged below with a ⚠️ badge.` : "No likely duplicates found.");
  } catch (e) {
    alert("Duplicate scan failed. Try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Scan for duplicates"; }
  }
}

// Storefront view counts, proxied through the Worker (the Cloudflare API token
// can't live in this page). Never blocks the rest of the admin panel from loading.
async function loadAnalytics() {
  const el = document.getElementById("analytics");
  if (!el) return;
  try {
    const resp = await fetch(`${WORKER_BASE_URL}/api/admin/analytics`, { headers: authHeaders() });
    const d = await resp.json();
    if (!resp.ok) {
      el.innerHTML = `<div class="muted-note">👁 Storefront views unavailable — ${escapeHtml(d.detail || d.error || "unknown error")}</div>`;
      return;
    }
    el.innerHTML = `
      <div><strong>👁 Storefront views</strong> — ${d.day.views.toLocaleString()} last 24h · ${d.week.views.toLocaleString()} last 7 days · ${d.month.views.toLocaleString()} last 30 days</div>
      <div class="muted-note">${d.week.visits.toLocaleString()} visits in the last 7 days · admin page is not tracked</div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="muted-note">👁 Storefront views unavailable — couldn't reach the analytics endpoint.</div>`;
  }
}

async function loadFxRate() {
  const resp = await fetch(`${WORKER_BASE_URL}/api/admin/config`, { headers: authHeaders() });
  const data = await resp.json();
  currentFxRate = data.fx_rate;
  document.getElementById("fxRate").value = data.fx_rate;
}

async function saveFxRate() {
  const rate = parseFloat(document.getElementById("fxRate").value);
  if (!rate) return;
  await fetch(`${WORKER_BASE_URL}/api/admin/config`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ fx_rate: rate }),
  });
  alert("Exchange rate saved. It applies to listings saved/published from now on.");
}

function renderGrouped(items, cardFn, emptyMessage) {
  if (!items.length) return `<div class="empty-state">${emptyMessage}</div>`;

  const byTitle = (a, b) => titleEn(a).localeCompare(titleEn(b));

  const sections = CATEGORIES
    .map((cat) => ({
      cat,
      items: items.filter((l) => l.category === cat).sort(byTitle),
    }))
    .filter((s) => s.items.length > 0);

  const uncategorized = items.filter((l) => !CATEGORIES.includes(l.category));
  if (uncategorized.length) sections.push({ cat: null, items: uncategorized.sort(byTitle) });

  sections.sort((a, b) => (CATEGORY_LABELS[a.cat] || "Other / Otro").localeCompare(CATEGORY_LABELS[b.cat] || "Other / Otro"));

  return sections.map((s) => `
    <div class="category-section">
      <h3 class="category-heading">${CATEGORY_ICONS[s.cat] || "📦"} ${CATEGORY_LABELS[s.cat] || "Other / Otro"} (${s.items.length})</h3>
      ${s.items.map(cardFn).join("")}
    </div>
  `).join("");
}

function renderTotals() {
  const active = allPublished.filter((l) => l.status !== "sold");
  const sold = allPublished.filter((l) => l.status === "sold");

  const activeCop = active.reduce((sum, l) => sum + (l.price_cop_max || 0), 0);
  const activeUsd = active.reduce((sum, l) => sum + (l.price_usd_max || 0), 0);
  const soldCop = sold.reduce((sum, l) => sum + (l.sold_price_cop != null ? l.sold_price_cop : (l.price_cop_max || 0)), 0);
  const soldUsd = sold.reduce((sum, l) => sum + (l.sold_price_usd != null ? l.sold_price_usd : (l.price_usd_max || 0)), 0);

  document.getElementById("totals").innerHTML = `
    <div><strong>${active.length}</strong> listed / en venta — ${activeCop.toLocaleString()} COP · $${activeUsd.toLocaleString()} USD suggested</div>
    <div><strong>${sold.length}</strong> sold / vendido — ${soldCop.toLocaleString()} COP · $${soldUsd.toLocaleString()} USD actual</div>
  `;
}

async function loadAll() {
  await loadFxRate();
  loadAnalytics();

  const draftsResp = await fetch(`${WORKER_BASE_URL}/api/admin/drafts`, { headers: authHeaders() });
  allDrafts = await draftsResp.json();
  document.getElementById("draftsCount").textContent = allDrafts.length ? `${allDrafts.length} pending` : "";
  document.getElementById("drafts").innerHTML = renderGrouped(allDrafts, draftCard, "No pending drafts.");

  const listingsResp = await fetch(`${WORKER_BASE_URL}/api/listings`);
  allPublished = await listingsResp.json();
  document.getElementById("published").innerHTML = renderGrouped(allPublished, publishedCard, "Nothing published yet.");

  renderTotals();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("saveFxRateBtn").addEventListener("click", saveFxRate);
  document.getElementById("refreshBtn").addEventListener("click", loadAll);
  document.getElementById("rescanDupesBtn").addEventListener("click", rescanDuplicates);
  document.getElementById("fxRate").addEventListener("input", refreshAllPricePreviews);

  if (getToken()) {
    document.getElementById("gate").style.display = "none";
    document.getElementById("adminBody").style.display = "block";
    loadAll();
  }
});
