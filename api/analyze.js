export const config = { runtime: "edge" };
 
const PROMPT = `The user draw in the air {black background, neon strokes}. Answer ONLY JSON, without backticks: {"texto" : "legible text if there isn't nothing null", "descripcion": "What do you see only 1 phrase", "comentario": "Creative opinion 1-2 phrases in english"}`; // FIX: missing closing " before }
 
async function tryClaude(b64) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{
            role: "user",
            content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
            { type: "text", text: PROMPT }
            ]
        }]
        })
    });
 
    if(!res.ok) {
        const err = await res.json();
        if(res.status === 401 || res.status === 403) throw new Error("Claude Auth Error"); // FIX: throw new err → throw new Error
        throw new Error(`claude_fallback: ${err.error?.message}`);
    }
 
    const data = await res.json();
    return {raw: data.content.map(b => b.text || "").join(""), provider: "Claude"};
}
 
async function tryGemini(b64) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
        method: "POST",
        headers: { "Content-Type": "application/json"},
        body: JSON.stringify({
            contents: [{
                parts: [
                    { inline_data: { mime_type: "image/png", data: b64}},
                    { text: PROMPT}
                ]
            }]
        })
    }
    );
    
    if (!res.ok) {
        const err = await res.json();
        if(res.status === 401 || res.status === 403) throw new Error("Gemini auth Error");
        throw new Error(`gemini_fallback: ${err.error?.message}`);
    }
 
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { raw, provider: "Gemini"};
}
 
async function tryGroq(b64) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        max_tokens: 500,
        messages: [{
            role: "user",
            content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            { type: "text", text: PROMPT }
            ]
        }]
        })
    });
 
    if (!res.ok) {
        const err = await res.json();
        throw new Error(`groq_error: ${err.error?.message}`);
    }
 
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    return { raw, provider: "Groq"};
}
 
function parseResult(raw, provider) {
    try {
        const clean = raw.replace(/```json|```/g, "").trim();
        const p = JSON.parse(clean);
        return { ...p, provider};
    } catch {
        return { texto: null, descripcion: "Analysis ready", comentario: raw.slice(0, 200), provider};
    }
}
 
export default async function handler(req) {
    if (req.method === "OPTIONS") {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    });
    }
 
    if(req.method !== "POST") {
        return new Response(JSON.stringify({error: "Method not allowed"}), { status: 405});
    }
 
    let b64;
    try {
        const body = await req.json();
        b64 = body.image;
        if(!b64) throw new Error("No image Provided");
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400});
    }
 
    const providers = [
        { name: "Claude", fn: () => tryClaude(b64) },
        { name: "Gemini", fn: () => tryGemini(b64) },
        { name: "Groq",   fn: () => tryGroq(b64)   },
    ];
 
    let lastError;
    for(const p of providers) {
        try {
            const { raw, provider } = await p.fn();
            const result = parseResult(raw, provider);
            return new Response(JSON.stringify(result), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                }
            });
        } catch (e) {
            console.warn(`[${p.name}] failed: ${e.message}, trying next...`);
            lastError = e;
            continue;
        }
    }
 
    return new Response(
        JSON.stringify({ error: "All the providers failed", detail: lastError?.message}),
        { status: 503, headers:{ "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }}
    );
}
 