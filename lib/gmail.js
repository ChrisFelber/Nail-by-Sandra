import crypto from 'node:crypto';

function b64url(value){return Buffer.from(value,'utf8').toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}

function envDiagnostic(value,{clientId=false}={}){
  const raw=String(value||'');
  const trimmed=raw.trim();
  return {
    present:Boolean(raw),
    length:raw.length,
    trimmed_length:trimmed.length,
    has_outer_whitespace:raw!==trimmed,
    has_newline:/[\r\n]/.test(raw),
    ...(clientId?{has_google_client_suffix:trimmed.endsWith('.apps.googleusercontent.com')}:{}) ,
    fingerprint:trimmed?crypto.createHash('sha256').update(trimmed).digest('hex').slice(0,12):null
  };
}

export async function gmailAccessToken(){
  const clientId=String(process.env.GOOGLE_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.GOOGLE_CLIENT_SECRET||'').trim();
  const refreshToken=String(process.env.GMAIL_REFRESH_TOKEN||'').trim();
  if(!clientId||!clientSecret||!refreshToken) throw new Error('GMAIL_CONFIG_MISSING');
  console.log('Gmail OAuth env diagnostic',{
    client_id:envDiagnostic(clientId,{clientId:true}),
    client_secret:envDiagnostic(clientSecret),
    refresh_token:envDiagnostic(refreshToken)
  });
  const r=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})
  });
  const d=await r.json();
  if(!r.ok||!d.access_token){
    const code=String(d.error||'GMAIL_TOKEN_FAILED');
    const desc=String(d.error_description||'').replace(/[\r\n]+/g,' ').slice(0,300);
    console.error('Gmail OAuth token error',{status:r.status,error:code,error_description:desc});
    throw new Error(`GMAIL_TOKEN_FAILED:${code}${desc?`:${desc}`:''}`);
  }
  return d.access_token;
}

export async function sendGmail({to,subject,body}){
  const token=await gmailAccessToken();
  const raw=[`To: ${to}`,'From: Nail by Sandra',`Subject: =?UTF-8?B?${Buffer.from(String(subject),'utf8').toString('base64')}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',String(body)].join('\r\n');
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(raw)})});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error?.message||'GMAIL_SEND_FAILED');
  return d;
}

export async function sendGmailToSelf({subject,body}){
  const to=String(process.env.GMAIL_NOTIFICATION_EMAIL||'').trim();
  if(!to||!to.includes('@')) throw new Error('GMAIL_NOTIFICATION_EMAIL_MISSING');
  return sendGmail({to,subject,body});
}
