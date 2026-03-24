import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

app.get("/", (req, res) => {
  res.send("trello-ai-ad-generator is running");
});

async function trelloGet(url, params = {}) {
  const res = await axios.get(url, {
    params: {
      key: process.env.TRELLO_KEY,
      token: process.env.TRELLO_TOKEN,
      ...params,
    },
  });
  return res.data;
}

async function trelloPost(url, data = null, params = {}, headers = {}) {
  const res = await axios.post(url, data, {
    params: {
      key: process.env.TRELLO_KEY,
      token: process.env.TRELLO_TOKEN,
      ...params,
    },
    headers,
    maxBodyLength: Infinity,
  });
  return res.data;
}

async function getCardByAnyId(cardIdOrShortLink) {
  console.log("Looking up card:", cardIdOrShortLink);

  // 1) Try direct card lookup first
  try {
    const direct = await trelloGet(`https://api.trello.com/1/cards/${cardIdOrShortLink}`, {
      fields: "id,name,desc,shortLink,idShort,labels",
      attachments: true,
      attachment_fields: "id,name,url,fileName,isUpload,mimeType",
      customFieldItems: true,
    });
    console.log("Direct lookup worked:", direct.id);
    return direct;
  } catch (err) {
    console.log("Direct lookup failed, trying search...");
  }

  // 2) Fallback: search Trello for the short link / idShort / title fragment
  const search = await trelloGet("https://api.trello.com/1/search", {
    query: cardIdOrShortLink,
    modelTypes: "cards",
    card_fields: "id,name,desc,shortLink,idShort,labels",
    cards_limit: 20,
    partial: true,
  });

  const cards = search.cards || [];

  const match = cards.find((c) => {
    return (
      c.id === cardIdOrShortLink ||
      c.shortLink === cardIdOrShortLink ||
      String(c.idShort) === String(cardIdOrShortLink)
    );
  });

  if (!match) {
    throw new Error(`Could not find card from value: ${cardIdOrShortLink}`);
  }

  console.log("Search lookup worked:", match.id);

  const fullCard = await trelloGet(`https://api.trello.com/1/cards/${match.id}`, {
    fields: "id,name,desc,shortLink,idShort,labels",
    attachments: true,
    attachment_fields: "id,name,url,fileName,isUpload,mimeType",
    customFieldItems: true,
  });

  return fullCard;
}

async function getBoardCustomFields(boardId) {
  return trelloGet(`https://api.trello.com/1/boards/${boardId}/customFields`);
}

function mapCustomFields(card, boardCustomFields) {
  const result = {};
  const items = card.customFieldItems || [];

  for (const item of items) {
    const fieldDef = boardCustomFields.find((f) => f.id === item.idCustomField);
    if (!fieldDef) continue;

    const key = fieldDef.name;
    let value = "";

    if (item.value?.text) value = item.value.text;
    else if (item.value?.number) value = item.value.number;
    else if (item.idValue && Array.isArray(fieldDef.options)) {
      const option = fieldDef.options.find((o) => o.id === item.idValue);
      value = option?.value?.text || "";
    }

    result[key] = value;
  }

  return result;
}

function extractClientName(cardName = "", customFields = {}) {
  if (customFields.client_name) return customFields.client_name.trim();
  if (cardName.includes(":")) return cardName.split(":")[0].trim();
  return cardName.trim();
}

function inferAdType(cardName = "", labels = []) {
  const name = (cardName || "").toLowerCase();
  const labelNames = labels.map((l) => (l.name || "").toLowerCase());

  if (labelNames.includes("social") || name.includes("social")) return "social";
  if (labelNames.includes("display") || name.includes("display")) return "display";

  return "social";
}

function inferSeasonFromText(text = "") {
  const t = text.toLowerCase();

  if (t.includes("march") || t.includes("april") || t.includes("may") || t.includes("spring")) {
    return "spring";
  }
  if (t.includes("june") || t.includes("july") || t.includes("august") || t.includes("summer")) {
    return "summer";
  }
  if (t.includes("september") || t.includes("october") || t.includes("november") || t.includes("fall")) {
    return "fall";
  }
  if (t.includes("december") || t.includes("january") || t.includes("february") || t.includes("winter")) {
    return "winter";
  }

  return "spring";
}

function safeSplit(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function randomPick(arr, fallback = "") {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickOfferFromRequestCard(card, customFields) {
  const title = (card.name || "").toLowerCase();
  const desc = (card.desc || "").toLowerCase();

  if (customFields.offer) return customFields.offer;
  if (title.includes("preowned") || title.includes("pre-owned") || desc.includes("pre-owned")) {
    return "pre-owned vehicle promotion";
  }
  if (title.includes("service") || desc.includes("service")) {
    return "service promotion";
  }
  if (title.includes("refresh") || desc.includes("refresh")) {
    return "campaign refresh";
  }

  return "vehicle promotion";
}

async function findPortfolioCardByClientName(clientName) {
  const search = await trelloGet("https://api.trello.com/1/search", {
    query: `${clientName} Client Portfolio`,
    modelTypes: "cards",
    card_fields: "id,name,shortLink,idShort,labels",
    cards_limit: 20,
    partial: true,
  });

  const cards = search.cards || [];
  const normalized = clientName.trim().toLowerCase();

  const match =
    cards.find((c) => c.name.trim().toLowerCase() === `${normalized} client portfolio`) ||
    cards.find((c) => c.name.trim().toLowerCase().includes(normalized));

  if (!match) {
    throw new Error(`No portfolio card found for client "${clientName}"`);
  }

  return trelloGet(`https://api.trello.com/1/cards/${match.id}`, {
    fields: "id,name,desc,shortLink,idShort,labels,idBoard",
    attachments: true,
    attachment_fields: "id,name,url,fileName,isUpload,mimeType",
    customFieldItems: true,
  });
}

function buildContext(requestCard, requestFields, portfolioFields) {
  const combinedText = [requestCard.name, requestCard.desc].filter(Boolean).join(" ");
  const clientName = extractClientName(requestCard.name, requestFields);
  const adType = inferAdType(requestCard.name, requestCard.labels || []);
  const season = inferSeasonFromText(combinedText);

  return {
    client: {
      name: portfolioFields.client_name || clientName,
    },
    campaign: {
      adType,
      offer: pickOfferFromRequestCard(requestCard, requestFields),
      objective: requestFields.objective || "traffic",
      cta: requestFields.primary_cta || portfolioFields.primary_cta || "Shop Now",
      season,
    },
    brand: {
      industry: portfolioFields.industry || "Automotive",
      tone: portfolioFields.tone || "Trustworthy | Local | Straightforward",
      target_audience: portfolioFields.target_audience || "Local drivers and families",
      visual_style: portfolioFields.visual_style || "Clean, real, local, polished",
      brand_colors: portfolioFields.brand_colors || "#003399 | #FFFFFF | #8c8e8f",
      brand_keywords: portfolioFields.brand_keywords || "community | trustworthy | local | family-friendly",
      image_style_reference:
        portfolioFields.image_style_reference ||
        "bright dealership photography | realistic | polished vehicles | natural light | minimal clutter",
    },
  };
}

function buildImagePrompt(context) {
  const { client, campaign, brand } = context;

  const socialScenarios = [
    "family browsing pre-owned vehicles on a bright dealership lot",
    "customer walking toward a polished pre-owned SUV with confidence",
    "friendly dealership interaction beside clean parked vehicles",
    "small-town lifestyle automotive scene with a dependable vehicle",
    "close-up hero view of a polished pre-owned vehicle with dealership atmosphere in the background",
  ];

  const displayScenarios = [
    "wide clean dealership lot with strong focal vehicle and negative space",
    "hero shot of a polished pre-owned vehicle framed for ad layout",
    "simple dealership scene with clean rows of vehicles and open composition",
    "commercial-style automotive image with strong subject focus and uncluttered background",
    "clean dealership image with room for future design overlays",
  ];

  const cameraAngles = [
    "natural eye-level composition",
    "cinematic low-angle shot",
    "wide-angle hero composition",
    "three-quarter front vehicle view",
    "clean commercial photography perspective",
  ];

  const lightingStyles = {
    spring: [
      "bright natural spring daylight",
      "fresh sunlight with soft shadows",
      "clean outdoor light with subtle greenery",
    ],
    summer: [
      "bright summer sunlight",
      "high-energy daylight with crisp contrast",
      "clear warm outdoor lighting",
    ],
    fall: [
      "soft autumn daylight",
      "warm seasonal light with subtle golden tones",
      "clean outdoor light with gentle warmth",
    ],
    winter: [
      "clean cool daylight",
      "crisp winter light with strong contrast",
      "bright daylight with minimal seasonal atmosphere",
    ],
  };

  const scenarios = campaign.adType === "display" ? displayScenarios : socialScenarios;
  const lights = lightingStyles[campaign.season] || lightingStyles.spring;

  const toneList = safeSplit(brand.tone).join(", ") || brand.tone || "trustworthy, local";
  const colorList =
    safeSplit(brand.brand_colors).join(", ") || brand.brand_colors || "#003399, #FFFFFF, #C0C0C0";

  return `
Create a HIGH-QUALITY AD CONCEPT IMAGE for creative direction only.
This is NOT a final ad.

Do NOT include:
- text overlays
- logos
- watermark
- collage layout
- graphic template styling
- fake UI
- fake typography
- logo recreation

Client:
${client.name}

Industry:
${brand.industry}

Campaign Type:
${campaign.adType}

Offer / Theme:
${campaign.offer}

Objective:
${campaign.objective}

Audience:
${brand.target_audience}

Brand Tone:
${toneList}

Visual Style:
${brand.visual_style}

Brand Keywords:
${brand.brand_keywords}

Image Style Reference:
${brand.image_style_reference}

Scene Direction:
${randomPick(scenarios, "clean dealership lifestyle scene")}

Camera Direction:
${randomPick(cameraAngles, "natural eye-level composition")}

Lighting Direction:
${randomPick(lights, "bright natural daylight")}

Color Direction:
Use subtle influence from these brand colors where natural and tasteful: ${colorList}

Requirements:
- realistic photography style
- polished vehicle presentation
- dealership or automotive lifestyle setting
- premium but approachable
- local, trustworthy, community feel
- commercially useful framing
- visually fresh and non-repetitive
- avoid generic stock-photo feeling

Important:
This should feel like a strong concept image a designer can use as inspiration, not a finished advertisement.
`.trim();
}

async function generateImage(prompt) {
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const base64 = result.data?.[0]?.b64_json;
  if (!base64) throw new Error("No image returned from OpenAI");

  const fileName = `img-${Date.now()}.png`;
  const filePath = path.join(TMP_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));

  return { fileName, filePath };
}

async function attachToCard(cardId, filePath, fileName) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  return trelloPost(`https://api.trello.com/1/cards/${cardId}/attachments`, form, { name: fileName }, form.getHeaders());
}

async function addCommentToCard(cardId, text) {
  return trelloPost(`https://api.trello.com/1/cards/${cardId}/actions/comments`, null, { text });
}

app.get("/generate-reference-image/:cardId", async (req, res) => {
  let tempFilePath = null;

  try {
    const { cardId } = req.params;
    console.log("Incoming ID:", cardId);

    const requestCard = await getCardByAnyId(cardId);
    console.log("Resolved request card:", requestCard.id, requestCard.name);

    const portfolioCard = await findPortfolioCardByClientName(
      extractClientName(requestCard.name, {})
    );
    console.log("Resolved portfolio card:", portfolioCard.id, portfolioCard.name);

    const boardCustomFields = await getBoardCustomFields(portfolioCard.idBoard);
    const requestFields = mapCustomFields(requestCard, boardCustomFields);
    const portfolioFields = mapCustomFields(portfolioCard, boardCustomFields);

    const context = buildContext(requestCard, requestFields, portfolioFields);
    const prompt = buildImagePrompt(context);

    const { fileName, filePath } = await generateImage(prompt);
    tempFilePath = filePath;

    const attachment = await attachToCard(requestCard.id, filePath, fileName);
    await addCommentToCard(
      requestCard.id,
      `AI concept image generated for ${context.client.name} (${context.campaign.adType}, ${context.campaign.season}).`
    );

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({
      ok: true,
      requestCardId: requestCard.id,
      portfolioCardId: portfolioCard.id,
      attachmentUrl: attachment.url,
    });
  } catch (err) {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    console.error("FULL ERROR:", err.response?.data || err.message);

    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
