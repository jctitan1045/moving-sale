const TOKEN_KEY = "moving_sale_admin_token";
const CATEGORIES = ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "sports", "pet", "other"];
const CONDITIONS = ["new", "like_new", "good", "fair", "worn"];

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

function selectOptions(options, selected) {
  return options.map((o) => `<option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>`).join("");
}

function titleEn(l) { return l.title_en || l.title || ""; }
function titleEs(l) { return l.title_es || l.title || l.title_en || ""; }
function descEn(l) { return l.description_en || l.description || ""; }
function descEs(l) { return l.description_es || l.description || l.description_en || ""; }
function invOf(l) { return l.inventory || 1; }

// Published listings default to read-only view mode; ids in here are being edited.
// Drafts always render in edit mode (they need review before going live).
const editingPublished = new Set();
const justSaved = new Set();

function modeBadge(mode) {
  if (mode === "editing") return `<span class="mode-badge editing">✏️ Editing</span>`;
  if (mode === "draft") return `<span class="mode-badge draft">✏️ Draft — needs review</span>`;
  return `<span class="mode-badge live">🟢 Live</span>`;
}

function editableFields(l) {
  return `
    <div><label>Title (English)</label><input class="f-title-en" value="${escapeHtml(titleEn(l))}"></div>
    <div><label>Título (Español)</label><input class="f-title-es" value="${escapeHtml(titleEs(l))}"></div>
    <div><label>Description (English)</label><textarea class="f-description-en">${escapeHtml(descEn(l))}</textarea></div>
    <div><label>Descripción (Español)</label><textarea class="f-description-es">${escapeHtml(descEs(l))}</textarea></div>
    <div class="row">
      <div><label>Category</label><select class="f-category">${selectOptions(CATEGORIES, l.category)}</select></div>
      <div><label>Condition</label><select class="f-condition">${selectOptions(CONDITIONS, l.condition)}</select></div>
    </div>
    <div class="row">
      <div><label>Suggested offer (COP) — shown to buyers as "or best offer"</label><input class="f-price-max" type="number" value="${l.price_cop_max}"></div>
      <div><label>Inventory (how many available)</label><input class="f-inventory" type="number" min="0" value="${invOf(l)}"></div>
    </div>
  `;
}

function readOnlyFields(l) {
  return `
    <div><strong>${escapeHtml(titleEn(l))}</strong> / <em>${escapeHtml(titleEs(l))}</em></div>
    <div>${escapeHtml(descEn(l))}</div>
    <div><em>${escapeHtml(descEs(l))}</em></div>
    <div>${l.category} · ${l.condition} · ${invOf(l)} available</div>
    <div>Suggested offer: ${l.price_cop_max.toLocaleString()} COP, or best offer</div>
    ${l.price_new_cop ? `<div class="ai-price-note">AI reasoning: new ≈ ${l.price_new_cop.toLocaleString()} COP → floor ${l.price_cop_min.toLocaleString()} / offer ${l.price_cop_max.toLocaleString()}</div>` : ""}
  `;
}

function savedFlash(id) {
  return justSaved.has(id) ? `<div class="saved-flash">✓ Saved</div>` : "";
}

function draftCard(l) {
  return `
    <div class="admin-item" data-id="${l.id}">
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="">
      <div class="admin-fields">
        ${modeBadge("draft")}
        ${savedFlash(l.id)}
        ${l.price_new_cop ? `<div class="ai-price-note">AI reasoning: new ≈ ${l.price_new_cop.toLocaleString()} COP → floor ${l.price_cop_min.toLocaleString()} / offer ${l.price_cop_max.toLocaleString()}</div>` : ""}
        ${editableFields(l)}
        <div class="admin-actions">
          <button onclick="publishDraft('${l.id}')">Publish</button>
          <button class="secondary" onclick="saveEdits('${l.id}', false)">Save edits</button>
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
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="">
      <div class="admin-fields">
        <span class="badge ${l.status === "sold" ? "sold" : ""}">${l.status}</span>
        ${modeBadge(editing ? "editing" : "live")}
        ${savedFlash(l.id)}
        ${editing ? editableFields(l) : readOnlyFields(l)}
        <div class="admin-actions">
          ${editing ? `
            <button onclick="saveEdits('${l.id}', true)">Save</button>
            <button class="secondary" onclick="cancelEdit('${l.id}')">Cancel</button>
          ` : `
            <button class="secondary" onclick="enterEdit('${l.id}')">Edit</button>
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
  await patchListing(id, { status: "sold" });
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

async function loadFxRate() {
  const resp = await fetch(`${WORKER_BASE_URL}/api/admin/config`, { headers: authHeaders() });
  const data = await resp.json();
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

async function loadAll() {
  const draftsResp = await fetch(`${WORKER_BASE_URL}/api/admin/drafts`, { headers: authHeaders() });
  const drafts = await draftsResp.json();
  document.getElementById("drafts").innerHTML = drafts.length
    ? drafts.map(draftCard).join("")
    : `<div class="empty-state">No pending drafts.</div>`;

  const listingsResp = await fetch(`${WORKER_BASE_URL}/api/listings`);
  const published = await listingsResp.json();
  document.getElementById("published").innerHTML = published.length
    ? published.map(publishedCard).join("")
    : `<div class="empty-state">Nothing published yet.</div>`;

  loadFxRate();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("unlockBtn").addEventListener("click", unlock);
  document.getElementById("saveFxRateBtn").addEventListener("click", saveFxRate);
  document.getElementById("refreshBtn").addEventListener("click", loadAll);

  if (getToken()) {
    document.getElementById("gate").style.display = "none";
    document.getElementById("adminBody").style.display = "block";
    loadAll();
  }
});
