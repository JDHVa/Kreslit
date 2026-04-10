import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(join(__dirname, "public")));

const PROMPT = `The user draw in the air {black background, neon strokes}. Answer ONLY JSON, without backticks: {"texto" : "legible text if there isn't nothing null", "descripcion": "What do you see only 1 phrase if its a math problem then write it", "comentario": "Creative opinion 1-2 phrases in english, if it's a math answer then put the answer of that math problem even integrals if yout think it's a integral"}`; 

async function tryClaude(b64) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
      { type: "text", text: PROMPT }
    ]}]})
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return { raw: data.content.map(b => b.text || "").join(""), provider: "Claude" };
}

async function tryGemini(b64) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [
      { inline_data: { mime_type: "image/png", data: b64 } },
      { text: PROMPT }
    ]}]})
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return { raw: data.candidates?.[0]?.content?.parts?.[0]?.text || "", provider: "Gemini" };
}

async function tryGroq(b64) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: "meta-llama/llama-4-scout-17b-16e-instruct", max_tokens: 500, messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      { type: "text", text: PROMPT }
    ]}]})
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.statusText); }
  const data = await res.json();
  return { raw: data.choices?.[0]?.message?.content || "", provider: "Groq" };
}

function parse(raw, provider) {
  try { return { ...JSON.parse(raw.replace(/```json|```/g, "").trim()), provider }; }
  catch { return { texto: null, descripcion: "ready", comentario: raw.slice(0, 200), provider }; }
}

app.post("/api/analyze", async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "No image" });

  const providers = [
    { name: "Groq",   fn: () => tryGroq(image)   },
    { name: "Gemini", fn: () => tryGemini(image) },
    { name: "Claude", fn: () => tryClaude(image) },
  ];

  for (const p of providers) {
    try {
      const { raw, provider } = await p.fn();
      return res.json(parse(raw, provider));
    } catch (e) {
      console.warn(`[${p.name}] fail: ${e.message} next...`);
    }
  }
  res.status(503).json({ error: "All the models fail" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\nhttp://localhost:${PORT}\n`));



