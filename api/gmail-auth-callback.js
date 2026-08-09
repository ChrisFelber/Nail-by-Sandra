import crypto from 'node:crypto';

const REDIRECT_URI='https://nail-by-sandra-4fon.vercel.app/api/gmail-auth-callback';

function secret(){const v=process.env.ADMIN_SESSION_SECRET;if(!v||v.length<32)throw new Error('ADMIN_SESSION_SECRET_MISSING');return v}
function safeEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function verifyState(state){
  if(!state||!state.includes('.')) return false;
  const [payload,sig]=state.split('.');
  const expected=crypto.createHmac('sha256',secret()).update(payload).digest('base64url');
  if(!safeEqual(sig,expected)) return false;
  try{const d=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return Number(d.exp)>Math.floor(Date.now()/1000)}catch{return false}
}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function page(title,body){return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8f3ef;color:#252120;margin:0;padding:32px}.card{max-width:760px;margin:8vh auto;background:#fffdfa;border:1px solid #e5d9d2;border-radius:24px;padding:28px;box-shadow:0 18px 50px rgba(66,48,42,.08)}h1{font:400 36px Georgia,serif}code,textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}textarea{width:100%;min-height:120px;padding:12px;border:1px solid #ddd;border-radius:12px;box-sizing:border-box}.note{color:#817773;line-height:1.6}.ok{color:#316b45}.err{color:#8b3f34}button,a{display:inline-block;margin-top:14px;border:0;border-radius:999px;padding:12px 18px;background:#252120;color:white;text-decoration:none;cursor:pointer}</style></head><body><div class="card">${body}</div></body></html>`}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).send('Méthode non autorisée.');
  try{
    const {code,state,error}=req.query||{};
    if(error) return res.status(400).send(page('Connexion Gmail refusée',`<h1 class="err">Connexion Gmail refusée</h1><p class="note">Google a retourné : ${esc(error)}</p>`));
    if(!verifyState(String(state||''))) return res.status(400).send(page('Lien expiré',`<h1 class="err">Lien invalide ou expiré</h1><p class="note">Revenez dans l’Espace Sandra et recommencez la connexion Gmail.</p>`));
    if(!code) return res.status(400).send(page('Code manquant',`<h1 class="err">Code OAuth manquant</h1>`));
    const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;
    if(!clientId||!clientSecret) throw new Error('GOOGLE_CLIENT_ID_OR_SECRET_MISSING');
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:String(code),client_id:clientId,client_secret:clientSecret,redirect_uri:REDIRECT_URI,grant_type:'authorization_code'})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error_description||d.error||'TOKEN_EXCHANGE_FAILED');
    if(!d.refresh_token) return res.status(400).send(page('Refresh token absent',`<h1 class="err">Aucun refresh token reçu</h1><p class="note">Recommencez la connexion Gmail et assurez-vous de confirmer l’accès demandé.</p>`));
    const token=esc(d.refresh_token);
    return res.status(200).send(page('Gmail connecté',`<h1 class="ok">Gmail autorisé ✅</h1><p class="note">Copiez la valeur ci-dessous dans Vercel comme variable <code>GMAIL_REFRESH_TOKEN</code>. Ne l’envoyez pas dans ChatGPT et ne la mettez pas dans GitHub.</p><textarea id="t" readonly>${token}</textarea><button onclick="navigator.clipboard.writeText(document.getElementById('t').value)">Copier le refresh token</button><p class="note">Dans Vercel : Settings → Environment Variables → <code>GMAIL_REFRESH_TOKEN</code> → Production + Preview → Save → Redeploy.</p><a href="/admin.html">Retour à l’Espace Sandra</a>`));
  }catch(e){console.error('Gmail OAuth callback:',e);return res.status(500).send(page('Erreur Gmail',`<h1 class="err">Connexion Gmail impossible</h1><p class="note">Diagnostic : ${esc(e?.message||'Erreur inconnue')}</p>`))}
}
