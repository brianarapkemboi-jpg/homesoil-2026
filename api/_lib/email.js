// ============================================================
// Transactional email via Resend (https://resend.com).
// Set RESEND_API_KEY and STORE_FROM_EMAIL in Vercel. If RESEND_API_KEY is unset
// these helpers no-op (return false) so features still work without email.
// ============================================================
const RESEND_API = 'https://api.resend.com/emails';

export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return false; // email not configured — skip
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.STORE_FROM_EMAIL || 'orders@homesoil2026.com',
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('Resend error:', res.status, t.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('Resend send failed:', err.message);
    return false;
  }
}

// Branded welcome + discount email for new Pick'em entrants.
export function pickemWelcomeHtml(name, promoCode, promoPercent) {
  const code = promoCode
    ? `<p style="font-size:15px;color:#0a1733;">Here's <strong>${promoPercent}% off</strong> your gear — use code
         <span style="display:inline-block;background:#0a1733;color:#fff;font-weight:700;letter-spacing:1px;padding:6px 12px;border-radius:8px;">${promoCode}</span>
         at checkout.</p>`
    : '';
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;">
    <h1 style="color:#0a1733;font-size:22px;">You're in, ${name}! ⚽🇺🇸</h1>
    <p style="font-size:15px;color:#374151;">Your World Cup 2026 Pick'em entry is locked in. Check back after each match to watch the leaderboard — top scorer wins free gear.</p>
    ${code}
    <p style="font-size:15px;color:#374151;">Good luck,<br/>Home Soil 2026</p>
    <p style="font-size:12px;color:#9ca3af;">Fan-inspired original artwork. Not affiliated with FIFA or U.S. Soccer.</p>
  </div>`;
}
