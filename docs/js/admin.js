const TOKEN_KEY = "moving_sale_admin_token";
const CATEGORIES = ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "other"];
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

function editableFields(l) {
  return `
    ${l.status ? `<span class="badge ${l.status === "sold" ? "sold" : ""}">${l.status}</span>` : ""}
    <div><label>Title (English)</label><input class="f-title-en" value="${escapeHtml(titleEn(l))}"></div>
    <div><label>Título (Español)</label><input class="f-title-es" value="${escapeHtml(titleEs(l))}"></div>
    <div><label>Description (English)</label><textarea class="f-description-en">${escapeHtml(descEn(l))}</textarea></div>
    <div><label>Descripción (Español)</label><textarea class="f-description-es">${escapeHtml(descEs(l))}</textarea></div>
    <div class="row">
      <div><label>Category</label><select class="f-category">${selectOptions(CATEGORIES, l.category)}</select></div>
      <div><label>Condition</label><select class="f-condition">${selectOptions(CONDITIONS, l.condition)}</select></div>
    </div>
    <div><label>Suggested offer (COP) — shown to buyers as "or best offer"</label><input class="f-price-max" type="number" value="${l.price_cop_max}"></div>
  `;
}

function draftCard(l) {
  return `
    <div class="admin-item" data-id="${l.id}">
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="">
      <div class="admin-fields">
        ${editableFields(l)}
        <div class="admin-actions">
          <button onclick="publishDraft('${l.id}')">Publish</button>
          <button class="secondary" onclick="saveEdits('${l.id}')">Save edits</button>
          <button class="danger" onclick="deleteListing('${l.id}')">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function publishedCard(l) {
  return `
    <div class="admin-item" data-id="${l.id}">
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="">
      <div class="admin-fields">
        ${editableFields(l)}
        <div class="admin-actions">
          <button onclick="saveEdits('${l.id}')">Save edits</button>
          ${l.status !== "sold" ? `<button class="secondary" onclick="markSold('${l.id}')">Mark sold</button>` : `<button class="secondary" onclick="markAvailable('${l.id}')">Mark available</button>`}
          <button class="danger" onclick="deleteListing('${l.id}')">Delete</button>
        </div>
      </div>
    </div>
  `;
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

async function saveEdits(id) {
  await patchListing(id, readFields(id));
  loadAll();
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
