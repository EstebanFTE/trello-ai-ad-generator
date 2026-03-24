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
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID;
const PORTFOLIO_LIST_NAME = process.env.PORTFOLIO_LIST_NAME || "Client Portfolios";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
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

  const seasonalCues = {
    spring: "Use subtle spring cues only: freshness, greenery, bright renewal, clean air.",
    summer: "Use subtle summer cues only: warmth, energy, open sky, vivid daylight.",
    fall: "Use subtle fall cues only: warm natural tones, understated autumn atmosphere.",
    winter: "Use subtle winter cues only: crisp light, contrast, clean minimal atmosphere.",
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
${brand.industry || "Automotive dealership"}

Campaign Type:
${campaign.adType}

Offer / Theme:
${campaign.offer}

Objective:
${campaign.objective}

Audience:
${brand.target_audience || "Local drivers and families"}

Brand Tone:
${toneList}

Visual Style:
${brand.visual_style || "Clean, real, local, polished automotive photography"}

Brand Keywords:
${brand.brand_keywords || "community, trustworthy, local, family-friendly"}

Image Style Reference:
${
  brand.image_style_reference ||
  "bright dealership photography, realistic, natural light, clean vehicles, minimal clutter"
}

Season:
${campaign.season}
${seasonalCues[campaign.season] || seasonalCues.spring}

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

async function trelloGet(url, params = {}) {
  const response = await axios.get(url, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
  return response.data;
}

async function getBoardLists(boardId) {
  return trelloGet(`https://api.trello.com/1/boards/${boardId}/lists`);
}

async function getBoardCards(boardId) {
  return trelloGet(`https://api.trello.com/1/boards/${boardId}/cards`, {
    fields: "id,name,desc,idList,labels,shortLink,idShort",
  });
}

async function getCardsInList(listId) {
  return trelloGet(`https://api.trello.com/1/lists/${listId}/cards`, {
    fields: "id,name,desc,idList,labels,shortLink,idShort",
  });
}

async function getCardByRealId(cardId) {
  return trelloGet(`https://api.trello.com/1/cards/${cardId}`, {
    fields: "id,name,desc,idList,labels,shortLink,idShort",
    attachments: true,
    attachment_fields: "id,name,url,fileName,isUpload,mimeType",
    customFieldItems: true,
  });
}

async function getCardByAnyId(cardIdOrShortLink) {
  const cards = await trelloGet(`https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/cards`, {
    fields: "id,name,shortLink,idShort",
  });

  const match = cards.find((card) => {
    return (
      card.id === cardIdOrShortLink ||
      card.shortLink === cardIdOrShortLink ||
      String(card.idShort) === String(cardIdOrShortLink)
    );
  });

  if (!match) {
    throw new Error(`Card not found: ${cardIdOrShortLink}`);
  }

  return trelloGet(`https://api.trello.com/1/cards/${match.id}`, {
    fields: "id,name,desc,idList,labels,shortLink",
    attachments: true,
    attachment_fields: "id,name,url,fileName,isUpload,mimeType",
    customFieldItems: true,
  });
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

async function findPortfolioListId(boardId) {
  const lists = await getBoardLists(boardId);
  const list = lists.find(
    (l) => l.name.trim().toLowerCase() === PORTFOLIO_LIST_NAME.trim().toLowerCase()
  );

  if (!list) {
    throw new Error(`Portfolio list "${PORTFOLIO_LIST_NAME}" not found`);
  }

  return list.id;
}

async function findPortfolioCardByClientName(clientName) {
  const portfolioListId = await findPortfolioListId(TRELLO_BOARD_ID);
  const cards = await getCardsInList(portfolioListId);

  const normalizedClient = clientName.trim().toLowerCase();

  const card =
    cards.find((c) => c.name.trim().toLowerCase() === `${normalizedClient} client portfolio`) ||
    cards.find((c) => c.name.trim().toLowerCase().includes(normalizedClient));

  if (!card) {
    throw new Error(`No portfolio card found for client "${clientName}"`);
  }

  return getCardByRealId(card.id);
}

async function attachFileToTrelloCard(cardId, filePath, fileName) {
  const form = new FormData();
  form.append("key", TRELLO_KEY);
  form.append("token", TRELLO_TOKEN);
  form.append("file", fs.createReadStream(filePath), fileName);
  form.append("name", fileName);

  const response = await axios.post(`https://api.trello.com/1/cards/${cardId}/attachments`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });

  return response.data;
}

async function addCommentToCard(cardId, text) {
  const response = await axios.post(`https://api.trello.com/1/cards/${cardId}/actions/comments`, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      text,
    },
  });

  return response.data;
}

async function generateConceptImage(prompt) {
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const imageBase64 = result.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new Error("No image returned from OpenAI");
  }

  const fileName = `concept-${Date.now()}.png`;
  const filePath = path.join(TMP_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(imageBase64, "base64"));

  return { fileName, filePath };
}

app.get("/", (req, res) => {
  res.send("trello-ai-ad-generator is running");
});

app.get("/generate-reference-image/:cardId", async (req, res) => {
  let tempFilePath = null;

  try {
    const { cardId } = req.params;

    const requestCard = await getCardByAnyId(cardId);
    const boardCustomFields = await getBoardCustomFields(TRELLO_BOARD_ID);
    const requestFields = mapCustomFields(requestCard, boardCustomFields);

    const clientName = extractClientName(requestCard.name, requestFields);
    const portfolioCard = await findPortfolioCardByClientName(clientName);
    const portfolioFields = mapCustomFields(portfolioCard, boardCustomFields);

    const context = buildContext(requestCard, requestFields, portfolioFields);
    const prompt = buildImagePrompt(context);

    const { fileName, filePath } = await generateConceptImage(prompt);
    tempFilePath = filePath;

    const attachment = await attachFileToTrelloCard(requestCard.id, filePath, fileName);

    await addCommentToCard(
      requestCard.id,
      `AI concept image generated for ${context.client.name} (${context.campaign.adType}, ${context.campaign.season}).`
    );

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      ok: true,
      clientName: context.client.name,
      adType: context.campaign.adType,
      season: context.campaign.season,
      portfolioCard: portfolioCard.name,
      requestCardId: requestCard.id,
      requestShortLink: requestCard.shortLink,
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      prompt,
    });
  } catch (error) {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    console.error("generate-reference-image error:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
