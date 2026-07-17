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
function imagesOf(l) { return l.image_keys && l.image_keys.length ? l.image_keys : (l.image_key ? [l.image_key] : []); }

const carouselIndex = new Map();

function carouselNav(id, delta, total) {
  const current = carouselIndex.get(id) || 0;
  carouselIndex.set(id, (current + delta + total) % total);
  renderListings();
}

// --- Lightbox (full-size image viewer) ---
let lightboxImages = [];
let lightboxIdx = 0;

function openLightbox(id, startIdx) {
  const listing = listings.find((l) => l.id === id);
  if (!listing) return;
  lightboxImages = imagesOf(listing);
  if (!lightboxImages.length) return;
  lightboxIdx = Math.min(startIdx || 0, lightboxImages.length - 1);
  renderLightbox();
  document.getElementById("lightbox").classList.add("open");
  document.body.classList.add("lightbox-open");
}

function renderLightbox() {
  document.getElementById("lightboxImg").src = `${WORKER_BASE_URL}/images/${lightboxImages[lightboxIdx]}`;
  const multi = lightboxImages.length > 1;
  document.querySelectorAll("#lightbox .lightbox-nav").forEach((b) => { b.style.display = multi ? "" : "none"; });
  const dots = document.getElementById("lightboxDots");
  dots.innerHTML = multi ? lightboxImages.map((_, i) => `<span class="dot ${i === lightboxIdx ? "active" : ""}"></span>`).join("") : "";
}

function lightboxNav(event, delta) {
  if (event) event.stopPropagation();
  const total = lightboxImages.length;
  lightboxIdx = (lightboxIdx + delta + total) % total;
  renderLightbox();
}

// Closes on the close button (force) or a backdrop click, but not clicks on the image itself.
function closeLightbox(event, force) {
  if (!force && event && event.target.id !== "lightbox") return;
  document.getElementById("lightbox").classList.remove("open");
  document.body.classList.remove("lightbox-open");
}

function cardHtml(l, cart) {
  const max = invOf(l);
  const inCart = cart[l.id] || 0;
  const maxed = inCart >= max;
  const buttonLabel = maxed ? "Max in cart / Máximo en el carrito" : "Add to cart / Agregar al carrito";
  const expanded = expandedIds.has(l.id);

  const imgs = imagesOf(l);
  const idx = Math.min(carouselIndex.get(l.id) || 0, imgs.length - 1);

  return `
    <div class="card">
      <div class="card-image-wrap">
        <img src="${WORKER_BASE_URL}/images/${imgs[idx]}" alt="${escapeHtml(titleEn(l))}" loading="lazy" onclick="openLightbox('${l.id}', ${idx})">
        ${imgs.length > 1 ? `
          <button class="carousel-nav prev" onclick="carouselNav('${l.id}', -1, ${imgs.length})">‹</button>
          <button class="carousel-nav next" onclick="carouselNav('${l.id}', 1, ${imgs.length})">›</button>
          <div class="carousel-dots">${imgs.map((_, i) => `<span class="dot ${i === idx ? "active" : ""}"></span>`).join("")}</div>
        ` : ""}
      </div>
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

// Builds the category dropdown from the currently-loaded listings, appending a
// live item count per category and hiding categories that have nothing for sale.
// Preserves the current selection when that category still has items.
function populateCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  const prev = select.value;
  const available = listings.filter((l) => l.status !== "sold");
  const counts = {};
  available.forEach((l) => { counts[l.category] = (counts[l.category] || 0) + 1; });

  const options = [`<option value="">All categories / Todas las categorías (${available.length})</option>`];
  CATEGORIES.forEach((c) => {
    const n = counts[c] || 0;
    if (n > 0) options.push(`<option value="${c}">${CATEGORY_LABELS[c]} (${n})</option>`);
  });
  select.innerHTML = options.join("");
  select.value = prev && counts[prev] ? prev : "";
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
      <h2 class="category-heading">${CATEGORY_ICONS[s.cat] || "📦"} ${CATEGORY_LABELS[s.cat] || s.cat} (${s.items.length})</h2>
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
    totalCop += (listing.price_cop_max || 0) * cart[id];
    totalUsd += (listing.price_usd_max || 0) * cart[id];
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
  let totalCop = 0;
  let totalUsd = 0;

  const lines = Object.entries(cart).map(([id, qty]) => {
    const listing = listings.find((l) => l.id === id);
    const name = listing ? titleEn(listing) : id;
    const price = listing ? `(${fmtCopShort(listing.price_cop_max)} COP, obo)` : "";
    if (listing) {
      totalCop += (listing.price_cop_max || 0) * qty;
      totalUsd += (listing.price_usd_max || 0) * qty;
    }
    return qty > 1 ? `- ${name} x${qty} ${price}` : `- ${name} ${price}`;
  });

  // Same total the buyer sees in the cart drawer, so the message they send matches it.
  const total = `Total (suggested): ${fmtCop(totalCop)} · ${fmtUsd(totalUsd)}`;
  return `Hi! I'm interested in these items from the moving sale:\n${lines.join("\n")}\n\n${total}\n\nDo you still have them?`;
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
    populateCategoryFilter();
    renderListings();
    renderCart();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Couldn't load listings right now. Try refreshing.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const categorySelect = document.getElementById("categoryFilter");
  categorySelect.innerHTML = `<option value="">All categories / Todas las categorías</option>`;
  categorySelect.addEventListener("change", renderListings);

  document.getElementById("cartToggle").addEventListener("click", () => toggleCart(true));
  document.getElementById("cartClose").addEventListener("click", () => toggleCart(false));
  document.getElementById("overlay").addEventListener("click", () => toggleCart(false));
  document.getElementById("whatsappBtn").addEventListener("click", openWhatsAppCheckout);

  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("lightbox").classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox(null, true);
    else if (e.key === "ArrowLeft" && lightboxImages.length > 1) lightboxNav(null, -1);
    else if (e.key === "ArrowRight" && lightboxImages.length > 1) lightboxNav(null, 1);
  });

  loadListings();
});
