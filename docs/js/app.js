const CART_KEY = "moving_sale_cart";
const CATEGORIES = ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "sports", "pet", "other"];
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

let listings = [];
const expandedIds = new Set();

function toggleDescription(id) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
  renderListings();
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCart();
  renderListings();
}

function addToCart(id) {
  const listing = listings.find((l) => l.id === id);
  const max = listing ? invOf(listing) : Infinity;
  const cart = getCart();
  const next = (cart[id] || 0) + 1;
  if (next > max) return;
  cart[id] = next;
  saveCart(cart);
}

function setQty(id, qty) {
  const listing = listings.find((l) => l.id === id);
  const max = listing ? invOf(listing) : Infinity;
  const cart = getCart();
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = Math.min(qty, max);
  }
  saveCart(cart);
}

function cartCount() {
  return Object.values(getCart()).reduce((sum, q) => sum + q, 0);
}

function fmtCop(n) {
  return `$${Number(n).toLocaleString("en-US")} COP`;
}

function fmtUsd(n) {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD`;
}

// Shorthand for chat text, e.g. 15000 -> "15k", 1250000 -> "1.25M"
function fmtCopShort(n) {
  if (n >= 1000000) return `${Number((n / 1000000).toFixed(2))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(1))}k`;
  return `${n}`;
}

// Fallbacks handle older listings saved before bilingual fields existed.
function titleEn(l) { return l.title_en || l.title || ""; }
function titleEs(l) { return l.title_es || l.title || l.title_en || ""; }
function descEn(l) { return l.description_en || l.description || ""; }
function descEs(l) { return l.description_es || l.description || l.description_en || ""; }
function invOf(l) { return l.inventory || 1; }

function cardHtml(l, cart) {
  const max = invOf(l);
  const inCart = cart[l.id] || 0;
  const maxed = inCart >= max;
  const buttonLabel = maxed ? "Max in cart / Máximo en el carrito" : "Add to cart / Agregar al carrito";
  const expanded = expandedIds.has(l.id);

  return `
    <div class="card">
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="${escapeHtml(titleEn(l))}" loading="lazy">
      <div class="card-body">
        <span class="badge">${l.condition}</span>
        ${max > 1 ? `<span class="badge">${max} available / disponibles</span>` : ""}
        <h3>${escapeHtml(titleEn(l))}</h3>
        <h4 class="title-es">${escapeHtml(titleEs(l))}</h4>
        <button class="read-desc-btn" onclick="toggleDescription('${l.id}')">
          ${expanded ? "Hide description / Ocultar ▲" : "Read description / Leer descripción ▼"}
        </button>
        ${expanded ? `
          <p>${escapeHtml(descEn(l))}</p>
          <p class="desc-es">${escapeHtml(descEs(l))}</p>
        ` : ""}
        <div class="price">
          <div class="price-label">Suggested offer / Oferta sugerida</div>
          <div class="price-amount">${fmtCop(l.price_cop_max)}</div>
          <div class="obo">or best offer / o mejor oferta</div>
          <div class="usd">${fmtUsd(l.price_usd_max)}</div>
        </div>
        <button ${maxed ? "disabled" : ""} onclick="addToCart('${l.id}')">${buttonLabel}</button>
      </div>
    </div>
  `;
}

function renderListings() {
  const grid = document.getElementById("grid");
  const categoryFilter = document.getElementById("categoryFilter").value;

  // Sold items are never shown on the public storefront — marking something
  // sold in admin removes it from here automatically, no visitor-facing toggle.
  const filtered = listings.filter((l) => {
    if (l.status === "sold") return false;
    if (categoryFilter && l.category !== categoryFilter) return false;
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No items match that filter yet.</div>`;
    return;
  }

  const cart = getCart();

  // Group by category (in CATEGORIES order), each becoming its own heading
  // section, with items sorted alphabetically by English title within it.
  const sections = CATEGORIES
    .map((cat) => ({
      cat,
      items: filtered
        .filter((l) => l.category === cat)
        .sort((a, b) => titleEn(a).localeCompare(titleEn(b))),
    }))
    .filter((s) => s.items.length > 0);

  grid.innerHTML = sections.map((s) => `
    <div class="category-section">
      <h2 class="category-heading">${CATEGORY_ICONS[s.cat] || "📦"} ${CATEGORY_LABELS[s.cat] || s.cat}</h2>
      <div class="grid">
        ${s.items.map((l) => cardHtml(l, cart)).join("")}
      </div>
    </div>
  `).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function renderCart() {
  const cart = getCart();
  const list = document.getElementById("cartItems");
  const ids = Object.keys(cart);

  document.getElementById("cartCount").textContent = cartCount();

  document.getElementById("whatsappBtn").disabled = !ids.length;

  if (!ids.length) {
    list.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
    document.getElementById("cartTotal").innerHTML = "";
    return;
  }

  let totalCop = 0;
  let totalUsd = 0;

  list.innerHTML = ids.map((id) => {
    const listing = listings.find((l) => l.id === id);
    if (!listing) return "";
    totalCop += listing.price_cop_max * cart[id];
    totalUsd += listing.price_usd_max * cart[id];
    return `
      <div class="cart-line">
        <span class="name">${escapeHtml(titleEn(listing))}</span>
        <input type="number" min="0" max="${invOf(listing)}" value="${cart[id]}" onchange="setQty('${id}', parseInt(this.value) || 0)">
        <button class="secondary" onclick="setQty('${id}', 0)">✕</button>
      </div>
    `;
  }).join("");

  document.getElementById("cartTotal").innerHTML = `
    <span>Total (suggested)</span>
    <span>${fmtCop(totalCop)} · ${fmtUsd(totalUsd)}</span>
  `;
}

function toggleCart(open) {
  document.getElementById("cartDrawer").classList.toggle("open", open);
  document.getElementById("overlay").classList.toggle("open", open);
}

function whatsAppCheckoutMessage() {
  const cart = getCart();
  const lines = Object.entries(cart).map(([id, qty]) => {
    const listing = listings.find((l) => l.id === id);
    const name = listing ? titleEn(listing) : id;
    const price = listing ? `(${fmtCopShort(listing.price_cop_max)} COP, obo)` : "";
    return qty > 1 ? `- ${name} x${qty} ${price}` : `- ${name} ${price}`;
  });
  return `Hi! I'm interested in these items from the moving sale:\n${lines.join("\n")}\n\nDo you still have them?`;
}

function openWhatsAppCheckout() {
  const cart = getCart();
  if (!Object.keys(cart).length) return;

  const url = `https://wa.me/${JORDAN_WHATSAPP}?text=${encodeURIComponent(whatsAppCheckoutMessage())}`;
  window.open(url, "_blank");

  localStorage.removeItem(CART_KEY);
  toggleCart(false);
  renderCart();
  renderListings();
}

async function loadListings() {
  const grid = document.getElementById("grid");
  grid.innerHTML = `<div class="empty-state">Loading items...</div>`;
  try {
    const resp = await fetch(`${WORKER_BASE_URL}/api/listings`);
    listings = await resp.json();
    renderListings();
    renderCart();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Couldn't load listings right now. Try refreshing.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const categorySelect = document.getElementById("categoryFilter");
  categorySelect.innerHTML = `<option value="">All categories / Todas las categorías</option>` +
    CATEGORIES.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join("");
  categorySelect.addEventListener("change", renderListings);

  document.getElementById("cartToggle").addEventListener("click", () => toggleCart(true));
  document.getElementById("cartClose").addEventListener("click", () => toggleCart(false));
  document.getElementById("overlay").addEventListener("click", () => toggleCart(false));
  document.getElementById("whatsappBtn").addEventListener("click", openWhatsAppCheckout);

  loadListings();
});
