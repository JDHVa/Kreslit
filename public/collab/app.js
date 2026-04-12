import { createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL  = window.SUPABASE_URL  || "";
const SUPABASE_ANON = window.SUPABASE_ANON || "";

const MAX_PANELS = 20;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const createBtn = document.getElementById("createBtn");
const panelName = document.getElementById("panelName");
const ownerNameI = document.getElementById("ownerNameI");
const createErr = document.getElementById("createErr");
const countLabel = document.getElementById("countLabel");
const cards = document.getElementById("cards");

async function loadPanels() {
    const{ data, error } = await sb.from("panels").select("*").order("created_at", { ascending: false });

    if (error) {
        cards.innerHTML = `<div class="empty">Error loading panels</div>`;
        return;
    }
    countLabel.textContent = `Panels (${data.length}/${MAX_PANELS})`;
    if (!data.length) {
        cards.innerHTML = `<div class="empty">No panels yet - create the first Oneeeee!</div>`;
        return;
    }

    cards.innerHTML = data.map(p => `
        <a class="panel-card" href="canvas.html?panel=${p.id}">
            <div>
                <div class="pname">${esc(p.name)}</div>
                <div class="powner">by ${esc(p.owner_name)}</div>
            </div>
            <div class="penter">Enter</div>
        </a>
    `).join("");
    createBtn.disabled = data.length >= MAX_PANELS;
    if (data.length >= MAX_PANELS) {
        createErr.style.display = "block";
        createErr.textContent = "Panel limit reached, please tell Jesus to add more or to eliminate a one.";
    }
}

createBtn.addEventListener("click", async () => {
    const name = panelName.value.trim();
    const owner_name = ownerNameI.value.trim();
    createErr.style.display = "none";
    if (!name || !owner_name) { 
        createErr.style.display = "block"; 
        createErr.textContent = "Panel name and owner name are required."; 
        return; 
    }
    createBtn.disabled = true;
    const {count} = await sb.from("panels").select("*", { count: "exact", head: true });
    if(count >= MAX_PANELS) { 
        createErr.style.display = "block"; 
        createErr.textContent = "Panel limit reached, please tell Jesus to add more or to eliminate a one."; 
        createBtn.disabled = false; 
        return; 
    }
    const { data, error } = await sb.from("panels").insert({ name, owner_name }).select().single();
    if (error) {
        createErr.style.display = "block";
        createErr.textContent = "Error creating panel: " + error.message;
        createBtn.disabled = false;
        return;
    }
    window.location = `canvas.html?panel=${data.id}`;
});

function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

loadPanels();