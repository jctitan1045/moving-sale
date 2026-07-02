const CART_KEY = "moving_sale_cart";
const CATEGORIES = ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "other"];

let listings = [];

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
}

function addToCart(id) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);
}

function setQty(id, qty) {
  const cart = getCart();
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = qty;
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

function renderListings() {
  const grid = document.getElementById("grid");
  const categoryFilter = document.getElementById("categoryFilter").value;

  const filtered = listings.filter((l) => !categoryFilter || l.category === categoryFilter);

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No items match that filter yet.</div>`;
    return;
  }

  grid.innerHTML = filtered.map((l) => `
    <div class="card">
      <img src="${WORKER_BASE_URL}/images/${l.image_key}" alt="${escapeHtml(l.title)}" loading="lazy">
      <div class="card-body">
        <span class="badge ${l.status === "sold" ? "sold" : ""}">${l.status === "sold" ? "SOLD" : l.condition}</span>
        <h3>${escapeHtml(l.title)}</h3>
        <p>${escapeHtml(l.description)}</p>
        <div class="price">
          ${fmtCop((l.price_cop_min + l.price_cop_max) / 2)}
          <div class="usd">${fmtUsd((l.price_usd_min + l.price_usd_max) / 2)} · range ${fmtCop(l.price_cop_min)}–${fmtCop(l.price_cop_max)}</div>
        </div>
        <button ${l.status === "sold" ? "disabled" : ""} onclick="addToCart('${l.id}')">
          ${l.status === "sold" ? "Sold" : "Add to cart"}
        </button>
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

  if (!ids.length) {
    list.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
    document.getElementById("checkoutForm").style.display = "none";
    return;
  }

  document.getElementById("checkoutForm").style.display = "flex";

  list.innerHTML = ids.map((id) => {
    const listing = listings.find((l) => l.id === id);
    if (!listing) return "";
    return `
      <div class="cart-line">
        <span class="name">${escapeHtml(listing.title)}</span>
        <input type="number" min="0" value="${cart[id]}" onchange="setQty('${id}', parseInt(this.value) || 0)">
        <button class="secondary" onclick="setQty('${id}', 0)">✕</button>
      </div>
    `;
  }).join("");
}

function toggleCart(open) {
  document.getElementById("cartDrawer").classList.toggle("open", open);
  document.getElementById("overlay").classList.toggle("open", open);
}

async function submitCheckout(event) {
  event.preventDefault();
  const cart = getCart();
  const items = Object.entries(cart).map(([id, qty]) => {
    const listing = listings.find((l) => l.id === id);
    return { id, title: listing ? listing.title : id, qty };
  });

  const buyer_name = document.getElementById("buyerName").value.trim();
  const buyer_phone = document.getElementById("buyerPhone").value.trim();

  if (!items.length || !buyer_name || !buyer_phone) return;

  const btn = document.getElementById("checkoutBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const resp = await fetch(`${WORKER_BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, buyer_name, buyer_phone }),
    });
    if (!resp.ok) throw new Error("checkout failed");

    document.getElementById("cartItems").style.display = "none";
    document.getElementById("checkoutForm").style.display = "none";
    document.getElementById("confirmation").style.display = "block";

    localStorage.removeItem(CART_KEY);
  } catch (err) {
    alert("Something went wrong sending your request. Please try again in a moment.");
    btn.disabled = false;
    btn.textContent = "Send request";
  }
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
  categorySelect.innerHTML = `<option value="">All categories</option>` +
    CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  categorySelect.addEventListener("change", renderListings);

  document.getElementById("cartToggle").addEventListener("click", () => toggleCart(true));
  document.getElementById("cartClose").addEventListener("click", () => toggleCart(false));
  document.getElementById("overlay").addEventListener("click", () => toggleCart(false));
  document.getElementById("checkoutForm").addEventListener("submit", submitCheckout);

  loadListings();
});
