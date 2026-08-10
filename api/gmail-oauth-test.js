import crypto from 'node:crypto';

function diag(value){
  const raw=String(value||'');
  const v=raw.trim();
  return {
    present:Boolean(raw),
    length:raw.length,
    clean:raw===v&&!/[\r\n]/.test(raw),
    fingerprint:v?crypto.createHash('sha256').update(v).digest('hex').slice(0,12):null
  };
}

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const clientId=String(process.env.GOOGLE_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.GOOGLE_CLIENT_SECRET||'').trim();
  const refreshToken=String(process.env.GMAIL_REFRESH_TOKEN||'').trim();
  if(!clientId||!clientSecret||!refreshToken) return res.status(500).json({ok:false,error:'GMAIL_CONFIG_MISSING'});

  const body=new URLSearchParams();
  body.set('client_id',clientId);
  body.set('client_secret',clientSecret);
  body.set('refresh_token',refreshToken);
  body.set('grant_type','refresh_token');

  const r=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:body.toString()
  });
  let data={};
  try{data=await r.json()}catch{}
  const result={
    ok:r.ok&&Boolean(data.access_token),
    google_status:r.status,
    error:data.error||null,
    error_description:data.error_description||null,
    token_type:data.token_type||null,
    expires_in:data.expires_in||null,
    env:{client_id:diag(clientId),client_secret:diag(clientSecret),refresh_token:diag(refreshToken)}
  };
  console.log('Isolated Gmail OAuth test',result);
  return res.status(result.ok?200:502).json(result);
}
