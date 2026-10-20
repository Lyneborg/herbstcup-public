import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {jsonRepresentation} from '../http-json.mjs';
import {participantRef,sourceKey,officialIdentities} from '../public/identity.js';
import {parseTournamentPage} from '../tournament-parser.mjs';

test('participant identities are scoped to their plan, not a matching name or numeric ID',()=>{
 const a='https://example.org/plan-a/',b='https://example.org/plan-b/';
 assert.notEqual(participantRef(a,1),participantRef(b,1));
 assert.equal(participantRef(a+'?setlang=en',1),participantRef(a,1));
 assert.equal(participantRef(a,null),null);
 assert.equal(sourceKey('not a URL'),null);
 const identity=officialIdentities({identityPages:[a,b].map(source=>({source,participants:[{ref:participantRef(source,1),name:'Team A'}]}))});
 assert.equal(identity.links.length,0);
});
test('unknown upstream markup fails closed without executing scripts',()=>{
 assert.throws(()=>parseTournamentPage('<html><script>throw Error("do not execute")</script></html>',{source:'https://example.org/plan/',prefix:'TEST'}));
});
test('gzip preserves the exact JSON snapshot, Unicode and corrections',async()=>{
 const snapshot={matches:Array.from({length:100},(_,i)=>({id:i,home:'Team Æ',away:'Team Ö',homeScore:2,awayScore:1,stale:true}))};
 const encoded=await jsonRepresentation(snapshot,'gzip');
 assert.equal(encoded.status,200);assert.equal(encoded.headers['Content-Encoding'],'gzip');
 assert.deepEqual(gunzipSync(encoded.body),Buffer.from(JSON.stringify(snapshot)));
 assert.equal(encoded.headers.Vary,'Accept-Encoding');
});
test('an explicit gzip exclusion wins and unsupported representations return 406',async()=>{
 const snapshot={data:'x'.repeat(2000)};
 const plain=await jsonRepresentation(snapshot,'gzip, gzip;q=0');
 assert.equal(plain.headers['Content-Encoding'],undefined);
 assert.deepEqual(JSON.parse(plain.body),snapshot);
 assert.equal((await jsonRepresentation(snapshot,'*;q=0')).status,406);
});
