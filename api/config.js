export default function handler(req) {
    return new Response (
    `window.SUPABASE_URL="${process.env.SUPABASE_URL}";
    window.SUPABASE_ANON_KEY="${process.env.SUPABASE_ANON_KEY}";`,
    { headers: { "Content-Type": "application/javascript" } }
    );
}


