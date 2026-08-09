function b64url(value){return Buffer.from(value,'utf8').toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}

export async function gmailAccessToken(){
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken=process.env.GMAIL_REFRESH_TOKEN;
  if(!clientId||!clientSecret||!refreshToken) throw new Error('GMAIL_CONFIG_MISSING');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const d=await r.json();
  if(!r.ok||!d.access_token) throw new Error(d.error_description||d.error||'GMAIL_TOKEN_FAILED');
  return d.access_token;
}

export async function gmailAccountEmail(token){
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${token}`}});
  const d=await r.json();
  if(!r.ok||!d.emailAddress) throw new Error(d.error?.message||'GMAIL_PROFILE_FAILED');
  return d.emailAddress;
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
  const token=await gmailAccessToken();
  const to=await gmailAccountEmail(token);
  const raw=[`To: ${to}`,'From: Nail by Sandra',`Subject: =?UTF-8?B?${Buffer.from(String(subject),'utf8').toString('base64')}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',String(body)].join('\r\n');
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(raw)})});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error?.message||'GMAIL_SEND_FAILED');
  return d;
}
