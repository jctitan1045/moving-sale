// moving-sale-worker
// Backend for Jordan's moving-sale marketplace: WhatsApp photo intake -> AI draft listing,
// public storefront API, admin review API, WhatsApp checkout handoff.

const DEFAULT_FX_RATE = 4000; // COP per USD, admin-editable via /api/admin/config
// A sender's most-recent draft stays the "reference" a new incoming photo is compared
// against for this long. Grouping is decided by the vision model (same item or not),
// NOT by this window — the window only bounds which draft counts as the comparison anchor.
const RECENT_DRAFT_WINDOW_MS = 15 * 60 * 1000;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Internal-Secret",
  };
}

function jsonResponse(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function isAdminAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

// Chunked base64 encoding — a plain spread/apply over a multi-MB Uint8Array
// blows the call-stack argument limit, so encode in slices and concatenate.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function sendWhatsApp(to, body, env) {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: body }),
  });
  const data = await resp.json();
  return { status: resp.status, sid: data.sid, error_code: data.error_code, error_message: data.message };
}

async function getListing(id, env) {
  const raw = await env.KV.get(`listing:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveListing(listing, env) {
  await env.KV.put(`listing:${listing.id}`, JSON.stringify(listing));
}

async function listListings(env) {
  const { keys } = await env.KV.list({ prefix: "listing:" });
  const listings = await Promise.all(keys.map(async (k) => {
    const raw = await env.KV.get(k.name);
    return raw ? JSON.parse(raw) : null;
  }));
  return listings.filter(Boolean);
}

async function getFxRate(env) {
  const raw = await env.KV.get("config:fx_rate");
  return raw ? parseFloat(raw) : DEFAULT_FX_RATE;
}

function computeUsd(copMin, copMax, fxRate) {
  return {
    price_usd_min: Math.round((copMin / fxRate) * 100) / 100,
    price_usd_max: Math.round((copMax / fxRate) * 100) / 100,
  };
}

// --- Twilio photo intake -> AI draft listing ---

function imagesOfListing(l) {
  return l.image_keys && l.image_keys.length ? l.image_keys : (l.image_key ? [l.image_key] : []);
}

const LISTING_TOOL = {
  name: "create_listing",
  description: "Create a resale marketplace listing draft from a photo of an item.",
  input_schema: {
    type: "object",
    properties: {
      is_same_item_as_reference: { type: "boolean", description: "Only meaningful when a REFERENCE PHOTO is included above: true if the NEW PHOTO is just another view/angle/detail of the SAME individual physical object shown in the reference (so it should be added to that same listing), false if it is a DIFFERENT item that needs its own listing. Decide by whether it is literally the same unit, not merely the same kind of product. If no reference photo was provided, set false." },
      title_en: { type: "string", description: "Short, specific item name, in English" },
      title_es: { type: "string", description: "Short, specific item name, in natural Spanish" },
      description_en: { type: "string", description: "2-3 honest sentences describing the item and its visible condition/wear, in English" },
      description_es: { type: "string", description: "2-3 honest sentences describing the item and its visible condition/wear, in natural Spanish" },
      category: { type: "string", enum: ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "sports", "pet", "other"] },
      condition: { type: "string", enum: ["new", "like_new", "good", "fair", "worn"] },
      price_new_cop: { type: "integer", description: "Colombian pesos — what this item costs brand new at retail in Colombia today. Reasoning anchor for the resale price below, not shown to buyers." },
      price_cop_min: { type: "integer", description: "Colombian pesos — bottom of the condition-based discount band applied to price_new_cop" },
      price_cop_max: { type: "integer", description: "Colombian pesos — top of the condition-based discount band applied to price_new_cop; this is the price shown to buyers" },
    },
    required: ["title_en", "title_es", "description_en", "description_es", "category", "condition", "price_new_cop", "price_cop_min", "price_cop_max"],
  },
};

const PRICING_PROMPT = `You are helping create a resale marketplace listing for an item being sold as part of a household moving sale in Medellín, Colombia. Analyze the NEW PHOTO and call create_listing with your best assessment.

Price the item in two steps, and show your work by filling in price_new_cop:
1. Estimate price_new_cop: what this item costs brand new at retail in Colombia today.
2. Apply a condition-based discount from that new price to get the resale range:
   - new: 85-100% of new price
   - like_new: 70-85% of new price
   - good: 55-70% of new price
   - fair: 40-55% of new price
   - worn: 25-40% of new price
   Set price_cop_max near the TOP of the applicable band — these listings should anchor a bit high, since buyers negotiate down anyway. Set price_cop_min near the bottom of the same band.

Write both an English and a Spanish version of the title and description — natural, native-quality translations, not literal word-for-word.`;

// One vision call. When `reference` is supplied (the sender's most recent in-progress
// draft), the model also decides whether the new photo is the SAME item as the reference
// via is_same_item_as_reference. Returns the parsed create_listing tool input.
async function analyzePhoto({ base64Image, contentType, body, reference }, env) {
  const captionLine = body && body.trim() ? `\n\nCaption from seller: "${body.trim()}"` : "";
  let promptText = PRICING_PROMPT + captionLine;
  const content = [];

  if (reference) {
    promptText += `\n\nA REFERENCE PHOTO of an item already being drafted (titled "${reference.title}") is included first, followed by the NEW PHOTO. First decide: is the NEW PHOTO just another view of that SAME individual object, or a DIFFERENT item? Set is_same_item_as_reference true only when it is clearly the identical unit — not merely the same kind of product. Then describe and price the NEW PHOTO's item in the remaining fields.`;
    content.push({ type: "text", text: `REFERENCE PHOTO (item already being drafted):` });
    content.push({ type: "image", source: { type: "base64", media_type: reference.contentType, data: reference.base64 } });
    content.push({ type: "text", text: "NEW PHOTO to evaluate and list:" });
    content.push({ type: "image", source: { type: "base64", media_type: contentType, data: base64Image } });
    content.push({ type: "text", text: promptText });
  } else {
    content.push({ type: "image", source: { type: "base64", media_type: contentType, data: base64Image } });
    content.push({ type: "text", text: promptText });
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      tools: [LISTING_TOOL],
      tool_choice: { type: "tool", name: "create_listing" },
      messages: [{ role: "user", content }],
    }),
  });

  const data = await resp.json();
  const toolUse = data?.content?.find((b) => b.type === "tool_use");
  return { parsed: toolUse?.input || null, rawText: toolUse ? "" : JSON.stringify(data?.content || data) };
}

// Assembles a listing record from a parsed AI draft. Falls back to a blank
// "Needs review" draft when the AI output didn't parse, so a photo is never lost.
function buildListingObject({ id, imageKeys, parsed, rawText, from, fxRate }) {
  if (parsed && parsed.title_en && typeof parsed.price_cop_min === "number") {
    const usd = computeUsd(parsed.price_cop_min, parsed.price_cop_max, fxRate);
    return {
      id,
      title_en: parsed.title_en,
      title_es: parsed.title_es || parsed.title_en,
      description_en: parsed.description_en || "",
      description_es: parsed.description_es || parsed.description_en || "",
      category: parsed.category || "other",
      condition: parsed.condition || "good",
      price_new_cop: parsed.price_new_cop || null,
      price_cop_min: parsed.price_cop_min,
      price_cop_max: parsed.price_cop_max,
      ...usd,
      inventory: 1,
      image_keys: imageKeys,
      status: "draft",
      created_at: new Date().toISOString(),
      source_phone: from || "",
    };
  }
  return {
    id,
    title_en: "Needs review",
    title_es: "Necesita revisión",
    description_en: rawText ? `AI output could not be parsed automatically: ${rawText.slice(0, 500)}` : "AI did not return a description.",
    description_es: "",
    category: "other",
    condition: "good",
    price_cop_min: 0,
    price_cop_max: 0,
    price_usd_min: 0,
    price_usd_max: 0,
    inventory: 1,
    image_keys: imageKeys,
    status: "draft",
    created_at: new Date().toISOString(),
    source_phone: from || "",
  };
}

function titleTokens(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/gi, "").split(/\s+/).filter((t) => t.length > 1);
}

// Cheap draft-creation-time check: another active listing in the same category with a
// strongly overlapping title is probably the same item listed twice. Returns the ids of
// likely matches. The deeper semantic pass lives in /api/admin/rescan-duplicates.
async function findPossibleDuplicates(listing, env, allListings) {
  const all = allListings || await listListings(env);
  const mine = new Set(titleTokens(listing.title_en || listing.title));
  if (!mine.size) return [];
  const matches = [];
  for (const other of all) {
    if (other.id === listing.id) continue;
    if (other.status !== "draft" && other.status !== "published") continue;
    if (other.category !== listing.category) continue;
    const otherTokens = titleTokens(other.title_en || other.title);
    if (!otherTokens.length) continue;
    const overlap = otherTokens.filter((t) => mine.has(t)).length;
    const ratio = overlap / Math.max(mine.size, otherTokens.length);
    if (ratio >= 0.6) matches.push(other.id);
  }
  return matches;
}

async function processPhotoIntake({ from, body, mediaUrl0, mediaContentType0 }, env) {
  if (!mediaUrl0) return;

  const id = crypto.randomUUID();

  // Twilio media URLs require Basic Auth with the account credentials to fetch bytes.
  const twilioAuth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const mediaResp = await fetch(mediaUrl0, { headers: { "Authorization": `Basic ${twilioAuth}` } });
  if (!mediaResp.ok) {
    await sendWhatsApp(env.TWILIO_TO, `⚠️ Couldn't download photo for a new listing (Twilio media fetch failed, status ${mediaResp.status}).`, env);
    return;
  }
  const imageBuffer = await mediaResp.arrayBuffer();
  const contentType = mediaContentType0 || "image/jpeg";

  await env.KV.put(`image:${id}`, imageBuffer, { metadata: { contentType } });
  const base64Image = arrayBufferToBase64(imageBuffer);

  // Content-based grouping: if this sender has a recent in-progress draft, hand its first
  // photo to the model alongside this new one and let it decide whether they're the same
  // physical item. This replaces the old fixed time window, which lumped every photo sent
  // in a burst into one listing regardless of what it showed.
  let referenceListing = null;
  let reference = null;
  if (from) {
    const ptrRaw = await env.KV.get(`recent_draft:${from}`);
    if (ptrRaw) {
      const cand = await getListing(JSON.parse(ptrRaw).listingId, env);
      if (cand && cand.status === "draft") {
        const refKey = imagesOfListing(cand)[0];
        const refImg = refKey ? await env.KV.getWithMetadata(`image:${refKey}`, { type: "arrayBuffer" }) : null;
        if (refImg && refImg.value) {
          referenceListing = cand;
          reference = {
            base64: arrayBufferToBase64(refImg.value),
            contentType: refImg.metadata?.contentType || "image/jpeg",
            title: cand.title_en || "item",
          };
        }
      }
    }
  }

  const { parsed, rawText } = await analyzePhoto({ base64Image, contentType, body, reference }, env);

  // Same item as the in-progress draft -> append this photo to it instead of starting a new listing.
  if (referenceListing && parsed && parsed.is_same_item_as_reference === true) {
    referenceListing.image_keys = [...imagesOfListing(referenceListing), id];
    await saveListing(referenceListing, env);
    if (from) {
      await env.KV.put(`recent_draft:${from}`, JSON.stringify({ listingId: referenceListing.id }), { expirationTtl: Math.ceil(RECENT_DRAFT_WINDOW_MS / 1000) });
    }
    await sendWhatsApp(env.TWILIO_TO, `📸 Added photo ${referenceListing.image_keys.length} to "${referenceListing.title_en}" (same item)`, env);
    return referenceListing.id;
  }

  const fxRate = await getFxRate(env);
  const listing = buildListingObject({ id, imageKeys: [id], parsed, rawText, from, fxRate });
  listing.possible_duplicate_of = await findPossibleDuplicates(listing, env);
  await saveListing(listing, env);

  if (from) {
    await env.KV.put(`recent_draft:${from}`, JSON.stringify({ listingId: listing.id }), { expirationTtl: Math.ceil(RECENT_DRAFT_WINDOW_MS / 1000) });
  }

  const dupNote = listing.possible_duplicate_of.length ? `\n⚠️ Might duplicate an existing listing — check admin.` : "";
  const confirmMsg = parsed
    ? `📦 Draft ready: "${listing.title_en}"\nSuggested offer: ${listing.price_cop_max.toLocaleString()} COP, or best offer${dupNote}\nReview & publish: ${env.STOREFRONT_URL}/admin.html`
    : `⚠️ Photo received but AI couldn't draft a description automatically. A blank draft was created — review & fill in: ${env.STOREFRONT_URL}/admin.html`;

  await sendWhatsApp(env.TWILIO_TO, confirmMsg, env);

  return id;
}

// Called by daily-assistant/worker.js's forwarding branch (JSON body, internal secret).
async function handleTwilioIntake(request, env, ctx) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  if (internalSecret !== env.INTERNAL_FORWARD_SECRET) {
    return jsonResponse({ error: "unauthorized" }, 401, env);
  }

  const payload = await request.json();
  ctx.waitUntil(processPhotoIntake(payload, env));
  return jsonResponse({ ok: true }, 200, env);
}

// Called directly by Twilio for the dedicated moving-sale WhatsApp number
// (native form-encoded webhook body, no internal secret involved).
async function handleTwilioWebhook(request, env, ctx) {
  const formData = await request.formData();
  const from = formData.get("From");
  const body = (formData.get("Body") || "").trim();
  const numMedia = parseInt(formData.get("NumMedia") || "0", 10);
  const mediaUrl0 = formData.get("MediaUrl0");
  const mediaContentType0 = formData.get("MediaContentType0");

  if (numMedia > 0 && mediaUrl0) {
    ctx.waitUntil(processPhotoIntake({ from, body, mediaUrl0, mediaContentType0 }, env));
  } else if (from) {
    ctx.waitUntil(sendWhatsApp(from, "This number is for the Medellín moving sale — send a photo of an item to list it for sale!", env));
  }

  return new Response("", { status: 200 });
}

// --- Public storefront API ---

async function handleGetListings(env) {
  const listings = await listListings(env);
  const visible = listings.filter((l) => l.status === "published" || l.status === "sold");
  return jsonResponse(visible, 200, env);
}

async function handleGetImage(id, env) {
  const result = await env.KV.getWithMetadata(`image:${id}`, { type: "arrayBuffer" });
  if (!result || !result.value) {
    return new Response("Not found", { status: 404, headers: corsHeaders(env) });
  }
  const contentType = result.metadata?.contentType || "image/jpeg";
  return new Response(result.value, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400", ...corsHeaders(env) },
  });
}

// --- Admin API ---

async function handleGetDrafts(env) {
  const listings = await listListings(env);
  const drafts = listings.filter((l) => l.status === "draft");
  return jsonResponse(drafts, 200, env);
}

async function handlePatchListing(id, request, env) {
  const listing = await getListing(id, env);
  if (!listing) return jsonResponse({ error: "not found" }, 404, env);

  const updates = await request.json();
  const merged = { ...listing, ...updates };

  // If price fields were touched, recompute USD at save time.
  if (updates.price_cop_min !== undefined || updates.price_cop_max !== undefined) {
    const fxRate = await getFxRate(env);
    const usd = computeUsd(merged.price_cop_min, merged.price_cop_max, fxRate);
    merged.price_usd_min = usd.price_usd_min;
    merged.price_usd_max = usd.price_usd_max;
  }

  // Actual sale price (may differ from the suggested offer after negotiating) gets its own USD conversion.
  if (updates.sold_price_cop !== undefined) {
    const fxRate = await getFxRate(env);
    merged.sold_price_usd = Math.round((updates.sold_price_cop / fxRate) * 100) / 100;
  }

  await saveListing(merged, env);
  return jsonResponse(merged, 200, env);
}

async function handleAddPhoto(id, request, env) {
  const listing = await getListing(id, env);
  if (!listing) return jsonResponse({ error: "not found" }, 404, env);

  const contentType = request.headers.get("Content-Type") || "image/jpeg";
  const imageBuffer = await request.arrayBuffer();
  if (!imageBuffer.byteLength) return jsonResponse({ error: "no image data" }, 400, env);

  const imageId = crypto.randomUUID();
  await env.KV.put(`image:${imageId}`, imageBuffer, { metadata: { contentType } });

  listing.image_keys = [...(listing.image_keys || (listing.image_key ? [listing.image_key] : [])), imageId];
  await saveListing(listing, env);

  return jsonResponse(listing, 200, env);
}

async function handleDeleteListing(id, env) {
  const listing = await getListing(id, env);
  const imageKeys = listing ? (listing.image_keys || (listing.image_key ? [listing.image_key] : [id])) : [id];
  await env.KV.delete(`listing:${id}`);
  await Promise.all(imageKeys.map((imgId) => env.KV.delete(`image:${imgId}`)));
  return jsonResponse({ ok: true }, 200, env);
}

// Extracts one photo from an over-grouped listing into its own AI-drafted listing.
// The admin client calls this once per photo, so each call stays a small single-image
// request — keeps a big split (e.g. 50 photos) under per-request subrequest limits.
async function handleSplitPhoto(request, env) {
  const { listing_id, image_key } = await request.json();
  if (!listing_id || !image_key) return jsonResponse({ error: "listing_id and image_key required" }, 400, env);

  const img = await env.KV.getWithMetadata(`image:${image_key}`, { type: "arrayBuffer" });
  if (!img || !img.value) return jsonResponse({ error: "image not found" }, 404, env);

  const contentType = img.metadata?.contentType || "image/jpeg";
  const base64Image = arrayBufferToBase64(img.value);
  const { parsed, rawText } = await analyzePhoto({ base64Image, contentType, body: "", reference: null }, env);

  const fxRate = await getFxRate(env);
  const newId = crypto.randomUUID();
  // Reuse the existing image bytes; the client detaches them from the original before
  // deleting it, so the shared image survives.
  const listing = buildListingObject({ id: newId, imageKeys: [image_key], parsed, rawText, from: "", fxRate });
  listing.possible_duplicate_of = await findPossibleDuplicates(listing, env);
  await saveListing(listing, env);

  return jsonResponse(listing, 200, env);
}

// Deeper, on-demand duplicate pass: hands every active listing's title/category to the
// model and asks it to group ones that are the SAME physical item listed more than once
// (catches synonyms/translations the token heuristic misses). Rewrites each listing's
// possible_duplicate_of to match the resulting groups.
async function handleRescanDuplicates(env) {
  const all = (await listListings(env)).filter((l) => l.status === "draft" || l.status === "published");
  if (all.length < 2) return jsonResponse({ groups: [], updated: 0 }, 200, env);

  const catalog = all.map((l) => ({ id: l.id, title: l.title_en || l.title || "", category: l.category, condition: l.condition, price_cop: l.price_cop_max }));

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [{
        name: "report_duplicate_groups",
        description: "Report groups of listing ids that appear to be the SAME physical item listed more than once.",
        input_schema: {
          type: "object",
          properties: {
            groups: {
              type: "array",
              description: "Each element is an array of 2+ listing ids that are very likely the same individual physical item duplicated across listings. Only group listings you are confident describe the same unit; never group items that are merely the same type/category.",
              items: { type: "array", items: { type: "string" } },
            },
          },
          required: ["groups"],
        },
      }],
      tool_choice: { type: "tool", name: "report_duplicate_groups" },
      messages: [{ role: "user", content: [{ type: "text", text: `Here is a catalog of marketplace listings from a single household moving sale. Identify any that are duplicates — the SAME physical item listed more than once (allow for differently worded or translated titles and small price differences). Do NOT group items that are merely the same product type but distinct units.\n\nCatalog JSON:\n${JSON.stringify(catalog)}` }] }],
    }),
  });

  const data = await resp.json();
  const toolUse = data?.content?.find((b) => b.type === "tool_use");
  const validIds = new Set(all.map((l) => l.id));
  const groups = ((toolUse?.input?.groups) || [])
    .map((g) => (Array.isArray(g) ? g.filter((x) => validIds.has(x)) : []))
    .filter((g) => g.length > 1);

  const dupMap = new Map(); // id -> Set of other ids in its group
  for (const g of groups) {
    for (const a of g) {
      if (!dupMap.has(a)) dupMap.set(a, new Set());
      for (const b of g) if (b !== a) dupMap.get(a).add(b);
    }
  }

  let updated = 0;
  await Promise.all(all.map(async (l) => {
    const next = dupMap.has(l.id) ? Array.from(dupMap.get(l.id)).sort() : [];
    const prev = (l.possible_duplicate_of || []).slice().sort();
    if (next.join(",") !== prev.join(",")) {
      l.possible_duplicate_of = next;
      await saveListing(l, env);
      updated++;
    }
  }));

  return jsonResponse({ groups, updated }, 200, env);
}

async function handleGetConfig(env) {
  const fxRate = await getFxRate(env);
  return jsonResponse({ fx_rate: fxRate }, 200, env);
}

async function handlePatchConfig(request, env) {
  const updates = await request.json();
  if (updates.fx_rate) {
    await env.KV.put("config:fx_rate", String(updates.fx_rate));
  }
  const fxRate = await getFxRate(env);
  return jsonResponse({ fx_rate: fxRate }, 200, env);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "POST" && path === "/twilio-intake") {
        return await handleTwilioIntake(request, env, ctx);
      }

      if (request.method === "POST" && path === "/twilio-webhook") {
        return await handleTwilioWebhook(request, env, ctx);
      }

      if (request.method === "GET" && path === "/api/listings") {
        return await handleGetListings(env);
      }

      if ((request.method === "GET" || request.method === "HEAD") && path.startsWith("/images/")) {
        return await handleGetImage(path.replace("/images/", ""), env);
      }

      if (request.method === "GET" && path === "/api/admin/drafts") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleGetDrafts(env);
      }

      if (request.method === "POST" && path === "/api/admin/split-photo") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleSplitPhoto(request, env);
      }

      if (request.method === "POST" && path === "/api/admin/rescan-duplicates") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleRescanDuplicates(env);
      }

      if (request.method === "POST" && path.startsWith("/api/admin/listings/") && path.endsWith("/photos")) {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleAddPhoto(path.replace("/api/admin/listings/", "").replace("/photos", ""), request, env);
      }

      if (request.method === "PATCH" && path.startsWith("/api/admin/listings/")) {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handlePatchListing(path.replace("/api/admin/listings/", ""), request, env);
      }

      if (request.method === "DELETE" && path.startsWith("/api/admin/listings/")) {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleDeleteListing(path.replace("/api/admin/listings/", ""), env);
      }

      if (request.method === "GET" && path === "/api/admin/config") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleGetConfig(env);
      }

      if (request.method === "PATCH" && path === "/api/admin/config") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handlePatchConfig(request, env);
      }

      return jsonResponse({ error: "not found" }, 404, env);
    } catch (err) {
      return jsonResponse({ error: "internal error", message: String(err) }, 500, env);
    }
  },
};
