import http from 'node:http';
const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'demo@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{full_name:'Kierownik demo'},identities:[],created_at:new Date().toISOString()};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user.id,aud:'authenticated',role:'authenticated',email:user.email,exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000)})+'.presentation-local-signature';
http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 if(req.url.startsWith('/auth/v1/')){res.setHeader('Content-Type','application/json'); if(req.url.includes('/user'))return res.end(JSON.stringify(user));return res.end(JSON.stringify({access_token:token,refresh_token:'presentation-local-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user}));}
 if(req.url.startsWith('/api/')){try{let parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts);const response=await fetch('http://127.0.0.1:3005'+req.url,{method:req.method,headers: {...req.headers,host:'127.0.0.1:3005'},...(body.length?{body}:{} )});res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')??'application/json');res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(502);res.end(JSON.stringify({detail:'Local preview unavailable'}));}return;}
 res.end('Local presentation fixture. No external authentication.');
}).listen(3099,'127.0.0.1',()=>console.log('Local preview auth fixture and API proxy: 3099'));
