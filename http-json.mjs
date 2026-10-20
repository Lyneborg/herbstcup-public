import {gzip as gzipCallback,constants} from 'node:zlib';
import {promisify} from 'node:util';
const gzip=promisify(gzipCallback);
function quality(header,name,fallback){
 const entries=String(header || '').toLowerCase().split(',').map(item=>item.trim().split(';').map(part=>part.trim()));
 const found=entries.filter(([coding])=>coding===name);
 if(!found.length)return fallback;
 // Conflicting duplicate entries are treated conservatively: an explicit q=0 wins.
 return Math.min(...found.map(parts=>{
  if(parts.length===1)return 1;
  if(parts.length!==2 || !/^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parts[1]))return 0;
  return Number(parts[1].slice(2));
 }));
}
/** Transport only: serialize one snapshot once, then optionally gzip those exact bytes. */
export async function jsonRepresentation(value,acceptEncoding,{compress=gzip}={}){
 const raw=Buffer.from(JSON.stringify(value),'utf8');
 const wildcard=quality(acceptEncoding,'*',null),gzipQ=quality(acceptEncoding,'gzip',wildcard ?? 0);
 const identityQ=quality(acceptEncoding,'identity',wildcard===0?0:1);
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};
 if(gzipQ<=0 && identityQ<=0)return {status:406,headers:{...headers,'Content-Length':'0'},body:Buffer.alloc(0)};
 if(gzipQ>0 && gzipQ>=identityQ && (raw.length>=1024 || identityQ===0)){
  try{const body=await compress(raw,{level:constants.Z_BEST_SPEED});return {status:200,headers:{...headers,'Content-Encoding':'gzip','Content-Length':String(body.length)},body};}
  catch(error){if(identityQ===0)throw error;}
 }
 return {status:200,headers:{...headers,'Content-Length':String(raw.length)},body:raw};
}
export async function sendPublicJson(req,res,value){
 const representation=await jsonRepresentation(value,req.headers['accept-encoding']);
 res.writeHead(representation.status,representation.headers);res.end(representation.body);
}
