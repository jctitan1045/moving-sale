// moving-sale-worker
// Backend for Jordan's moving-sale marketplace: WhatsApp photo intake -> AI draft listing,
// public storefront API, admin review API, WhatsApp checkout handoff.

const DEFAULT_FX_RATE = 4000; // COP per USD, admin-editable via /api/admin/config

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

  const captionLine = body && body.trim()
    ? `\n\nCaption from seller: "${body.trim()}"`
    : "";

  const prompt = `You are helping create a resale marketplace listing for an item being sold as part of a household moving sale in Medellín, Colombia. Analyze the attached photo${captionLine} and call create_listing with your best assessment. Write both an English and a Spanish version of the title and description — natural, native-quality translations, not literal word-for-word. Base the price range on realistic LOCAL Medellín secondhand resale value, not international retail price.`;

  const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      tools: [{
        name: "create_listing",
        description: "Create a resale marketplace listing draft from a photo of an item.",
        input_schema: {
          type: "object",
          properties: {
            title_en: { type: "string", description: "Short, specific item name, in English" },
            title_es: { type: "string", description: "Short, specific item name, in natural Spanish" },
            description_en: { type: "string", description: "2-3 honest sentences describing the item and its visible condition/wear, in English" },
            description_es: { type: "string", description: "2-3 honest sentences describing the item and its visible condition/wear, in natural Spanish" },
            category: { type: "string", enum: ["furniture", "appliances", "electronics", "kitchenware", "decor", "clothing", "books", "outdoor", "other"] },
            condition: { type: "string", enum: ["new", "like_new", "good", "fair", "worn"] },
            price_cop_min: { type: "integer", description: "Colombian pesos, realistic local Medellín secondhand resale value" },
            price_cop_max: { type: "integer", description: "Colombian pesos, upper end of realistic local resale value" },
          },
          required: ["title_en", "title_es", "description_en", "description_es", "category", "condition", "price_cop_min", "price_cop_max"],
        },
      }],
      tool_choice: { type: "tool", name: "create_listing" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  const anthropicData = await anthropicResp.json();
  const toolUse = anthropicData?.content?.find((b) => b.type === "tool_use");
  const parsed = toolUse?.input || null;
  const rawText = parsed ? "" : JSON.stringify(anthropicData?.content || anthropicData);

  const fxRate = await getFxRate(env);

  let listing;
  if (parsed && parsed.title_en && typeof parsed.price_cop_min === "number") {
    const usd = computeUsd(parsed.price_cop_min, parsed.price_cop_max, fxRate);
    listing = {
      id,
      title_en: parsed.title_en,
      title_es: parsed.title_es || parsed.title_en,
      description_en: parsed.description_en || "",
      description_es: parsed.description_es || parsed.description_en || "",
      category: parsed.category || "other",
      condition: parsed.condition || "good",
      price_cop_min: parsed.price_cop_min,
      price_cop_max: parsed.price_cop_max,
      ...usd,
      inventory: 1,
      image_key: id,
      status: "draft",
      created_at: new Date().toISOString(),
      source_phone: from || "",
    };
  } else {
    // AI output didn't parse — still create a draft so the photo isn't lost, Jordan fills in details manually.
    listing = {
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
      image_key: id,
      status: "draft",
      created_at: new Date().toISOString(),
      source_phone: from || "",
    };
  }

  await saveListing(listing, env);

  const confirmMsg = parsed
    ? `📦 Draft ready: "${listing.title_en}"\nSuggested offer: ${listing.price_cop_max.toLocaleString()} COP, or best offer\nReview & publish: ${env.STOREFRONT_URL}/admin.html`
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

  await saveListing(merged, env);
  return jsonResponse(merged, 200, env);
}

async function handleDeleteListing(id, env) {
  await env.KV.delete(`listing:${id}`);
  await env.KV.delete(`image:${id}`);
  return jsonResponse({ ok: true }, 200, env);
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

// --- Checkout ---

async function handleCheckout(request, env) {
  const payload = await request.json();
  const { items, buyer_name, buyer_phone } = payload;

  if (!items || !items.length || !buyer_name || !buyer_phone) {
    return jsonResponse({ error: "missing items, buyer_name, or buyer_phone" }, 400, env);
  }

  const id = crypto.randomUUID();
  const lines = [];
  for (const cartItem of items) {
    const listing = await getListing(cartItem.id, env);
    if (listing) {
      const qty = cartItem.qty || 1;
      const inventory = listing.inventory || 1;
      const flags = [
        listing.status === "sold" ? "already marked sold" : null,
        qty > inventory ? `requested ${qty}, only ${inventory} in stock` : null,
      ].filter(Boolean);
      lines.push(`- ${listing.title_en} x${qty} (suggested offer: ${listing.price_cop_max.toLocaleString()} COP, OBO)${flags.length ? ` [${flags.join(", ")}]` : ""}`);
    } else {
      lines.push(`- ${cartItem.title || cartItem.id} x${cartItem.qty || 1} [listing not found]`);
    }
  }

  const message = `🛒 New inquiry from ${buyer_name} (${buyer_phone}):\n${lines.join("\n")}\n\nReply to arrange payment/pickup.`;

  const inquiry = {
    id,
    items,
    buyer_name,
    buyer_phone,
    created_at: new Date().toISOString(),
  };

  const sendResult = await sendWhatsApp(env.TWILIO_TO, message, env);
  inquiry.whatsapp_sent = !sendResult.error_code;
  inquiry.whatsapp_error_code = sendResult.error_code || null;

  // Always persist the inquiry, even if the WhatsApp send failed, so the buyer's info isn't lost.
  await env.KV.put(`inquiry:${id}`, JSON.stringify(inquiry));

  return jsonResponse({ ok: true, id }, 200, env);
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

      if (request.method === "GET" && path.startsWith("/images/")) {
        return await handleGetImage(path.replace("/images/", ""), env);
      }

      if (request.method === "GET" && path === "/api/admin/drafts") {
        if (!isAdminAuthorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401, env);
        return await handleGetDrafts(env);
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

      if (request.method === "POST" && path === "/api/checkout") {
        return await handleCheckout(request, env);
      }

      return jsonResponse({ error: "not found" }, 404, env);
    } catch (err) {
      return jsonResponse({ error: "internal error", message: String(err) }, 500, env);
    }
  },
};
