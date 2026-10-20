import {participantRef} from './public/identity.js';
// Public JSON and rendered text only. Never execute upstream scripts.
function pageData(html, name="_cpStadiumData") {
  const marker = name==='preloadedState' ? /window\.preloadedState\s*=\s*/g : /window\._cpStadiumData\s*=\s*/g, found = marker.exec(html);
  if (!found || marker.exec(html)) throw new Error('Missing or ambiguous official page data');
  const start = found.index + found[0].length;
  let depth = 0, quoted = false, escaped = false;
  if (html[start] !== '{') throw new Error('Invalid official JSON');
  for (let i = start; i < html.length && i - start < 1_000_000; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('Incomplete official JSON');
}
function text(value) {
  const entities = { ndash:'–', mdash:'—', nbsp:' ', amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', auml:'ä', ouml:'ö', uuml:'ü', Auml:'Ä', Ouml:'Ö', Uuml:'Ü', szlig:'ß', eacute:'é', colon:':' };
  return String(value).replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole,key)=>key[0]==='#'?String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1))):entities[key]??whole).replace(/\s+/gu,' ').trim();
}
function rankingTotals(row) {
  const value=title=>{
    const cells=[...row.matchAll(/<div\b([^>]*)>([^<>]*)<\/div>/gi)].filter(match=>new RegExp(`\\btitle=["']${title}["']`).test(match[1]));
    return cells.length===1?text(cells[0][2]):null;
  };
  const goals=/^(\d+)\s*:\s*(\d+)$/.exec(value('common.tournament.goals') || '');
  const points=value('common.tournament.points'),played=value('common.tournament.matches');
  return goals && /^\d+$/.test(points || '') && /^\d+$/.test(played || '') ? {gf:Number(goals[1]),ga:Number(goals[2]),points:Number(points),played:Number(played)} : null;
}
function cell(row, className) {
  const pattern = new RegExp(`<div\\b(?=[^>]*\\brole\\s*=\\s*["']cell["'])(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'])[^>]*>`, 'gi');
  const found = pattern.exec(row);
  if (!found || pattern.exec(row)) throw new Error(`Missing or duplicate ${className} cell`);
  const start = found.index + found[0].length;
  const tags = /<\/?div\b[^>]*>/gi; tags.lastIndex = start;
  let depth = 1, token;
  while ((token = tags.exec(row))) { depth += token[0].startsWith('</') ? -1 : 1; if (!depth) return row.slice(start,token.index); }
  throw new Error('Incomplete official cell');
}

function divContents(html, opening) {
  const tags=/<\/?div\b[^>]*>/gi; tags.lastIndex=opening.index+opening[0].length;
  const start=tags.lastIndex; let depth=1,token;
  while ((token=tags.exec(html))) {depth+=token[0].startsWith('</')?-1:1;if(!depth)return html.slice(start,token.index);}
  return null;
}
function addressKey(address) {
  return text(address).normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).sort().join(' ');
}
function venueFrom(address,mapUrl,source) {
  address=text(address||'');
  const base={id:address?addressKey(address):null,address:address||null,mapUrl:null,source,status:'uncertain'};
  if(!address)return {...base,reason:'missing-address'};
  if(!mapUrl)return {...base,status:'confirmed'};
  try {
    const url=new URL(text(mapUrl));
    const allowed=['maps.google.com','maps.google.de','www.google.com','www.google.de','google.com','google.de'];
    const query=url.searchParams.get('q') || url.searchParams.get('destination') || url.searchParams.get('query');
    if(url.protocol!=='https:' || !allowed.includes(url.hostname) || url.username || url.password || !/^\/maps(?:\/|$)/.test(url.pathname) || !query || addressKey(query)!==base.id) return {...base,reason:'map-address-mismatch'};
    return {...base,mapUrl:url.href,status:'confirmed'};
  } catch {return {...base,reason:'invalid-map-url'};}
}
function pageVenue(html,source) {
  const pattern=/<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bcp-info-item\b[^"']*["'])[^>]*>/gi;
  let opening;const venues=[];
  while((opening=pattern.exec(html))) {
    const content=divContents(html,opening);if(!content)continue;
    const label=content.match(/<div\b[^>]*class=["'][^"']*cp-info-item-label[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if(!label || text(label[1])!=='Veranstaltungsort')continue;
    const remainder=content.slice(label.index+label[0].length);
    const anchor=remainder.match(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    venues.push(venueFrom(anchor?anchor[2]:remainder,anchor?anchor[1]:null,source));
  }
  if(venues.length!==1)return {id:null,address:null,mapUrl:null,source,status:'uncertain',reason:venues.length?'ambiguous-address':'missing-address'};
  return venues[0];
}
function explicitVenue(match,court,source,fallback) {
  for(const candidate of [match,court]) {
    if(!candidate)continue;
    const address=typeof candidate.address==='string'?candidate.address:typeof candidate.venue==='string'?candidate.venue:candidate.venue?.address;
    if(typeof address==='string')return venueFrom(address,candidate.mapUrl || candidate.venue?.mapUrl || null,source);
  }
  return fallback;
}
function parsePlanLinks(html,source,className) {
  const pattern=new RegExp(`<div\\b(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'])[^>]*>`, 'gi');
  let opening;const links=[];
  while((opening=pattern.exec(html))) {
    const content=divContents(html,opening);if(!content)continue;
    for(const anchor of content.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try {const url=new URL(text(anchor[1]),source);if(url.protocol!=='https:' || !['www.meinturnierplan.de','meinturnierplan.de'].includes(url.hostname) || url.username || url.password)continue;
        if(!links.some(link=>link.url===url.href))links.push({url:url.href,title:text(anchor[2])});
      }catch { /* Invalid links do not affect scores. */ }
    }
  }
  return links;
}

export const parseOfficialFollowups=(html,source)=>parsePlanLinks(html,source,'cp-info-followups');

export function isQualifierLabel(name) {
  return /^(?:\d+\.\s*(?:Gruppe|Group)|(?:Bester?|Zweitbester?|Drittbester?|Viertbester?|Fünftbester?|Fuenftbester?|Schlechtester?|Sieger|Verlierer|Winner|Loser|Best|Worst|Second|Third|Fourth|Fifth)\b|[–—-]$)/iu.test(name || '');
}
function officialId(content,fallback,data) {
 const ids=[...new Set([...content.matchAll(/filterByTeam\('\s*(\d+)\s*'\)/g)].map(m=>m[1]))];
 if(ids.length>1 || (ids.length && !data.participants[ids[0]]))throw new Error('Ambiguous official participant ID');
 const id=ids[0] || (fallback!=null?String(fallback):null);return id && data.participants[id]?id:null;
}
function resolveTeam(content, participant, data, slot, label) {
  const ids = [...content.matchAll(/filterByTeam\('\s*(\d+)\s*'\)/g)].map(m=>m[1]);
  const unique = [...new Set(ids)];
  if (unique.length > 1) throw new Error('Ambiguous official participant');
  const named = unique.length ? data.participants[unique[0]]?.name : participant?.name;
  if (unique.length && !data.participants[unique[0]]) throw new Error('Unknown official participant');
  if (named && !isQualifierLabel(named)) return named;
  if (slot) {
    // Resolved qualifiers display an official team name as the final text div.
    const leaves = [...content.matchAll(/<div\b[^>]*>([^<>]*)<\/div>/g)].map(m=>text(m[1])).filter(Boolean);
    const candidates = leaves.filter(name=>!isQualifierLabel(name) && name!==label);
    if (candidates.length===1 && !/filter nach|entferne|zeige/i.test(candidates[0])) return candidates[0];
  }
  return null;
}
function parseClassicPage(html,{source,prefix,duration=null,round=null}={}) {
  if (typeof html!=='string' || html.length>5_000_000 || !source || !/^[A-Za-z0-9_-]+$/.test(prefix||'')) throw new Error('Invalid tournament parser input');
  const data = pageData(html);
  const venue=pageVenue(html,source),followups=parseOfficialFollowups(html,source);
  const predecessors=parsePlanLinks(html,source,'cp-info-predecessors');
  let canonicalSource=null;try{const canonical=html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];if(canonical){const u=new URL(text(canonical),source);if(u.protocol==='https:' && !u.username && !u.password && ['www.meinturnierplan.de','meinturnierplan.de'].includes(u.hostname))canonicalSource=u.href;}}catch{}
  const durations=[...html.matchAll(/<div[^>]*>\s*(\d{1,3})\s+Minuten\s*<\/div>/g)].map(m=>Number(m[1]));
  duration=durations[0] || null;
  if (!data.participants || !Array.isArray(data.groups) || !Array.isArray(data.finalGroups) || !Array.isArray(data.groupMatches) || !Array.isArray(data.finalMatches)) throw new Error('Invalid tournament structure');
  const participants=Object.entries(data.participants).map(([id,p])=>({id,ref:participantRef(source,id),source,name:p.name && !isQualifierLabel(p.name)?p.name:null,label:p.sourceDisplay || p.displayName || p.name || null,kind:p.source || isQualifierLabel(p.sourceDisplay || p.displayName || p.name)?'slot':'team',slot:p.source || (isQualifierLabel(p.sourceDisplay || p.displayName || p.name)?{type:'label',label:p.sourceDisplay || p.displayName || p.name}:null)}));
  const groups = [...data.groups.map(g=>({...g,stage:'group'})),...data.finalGroups.map(g=>({...g,stage:'final'}))].map(g=>({id:g.displayId,name:g.name,stage:g.stage,round,source,teams:[],teamRefs:[],teamLabels:[],officialRanking:[]}));
  if (groups.some(g=>!g.id) || new Set(groups.map(g=>g.id)).size!==groups.length) throw new Error('Ambiguous official groups');
  const rows = new Map();
  for (const row of html.split(/(?=<div\s+[^>]*\brole\s*=\s*["']row["'][^>]*>)/i).slice(1)) {
    if (!/\btournament-grid\b/.test(row.slice(0,row.indexOf('>')+1))) continue;
    const id = row.match(/matchContextMenu\('(\d+)'\)/)?.[1];
    if (!id && /table-header/.test(row.slice(0,row.indexOf('>')+1))) continue;
    if (!id || rows.has(id)) throw new Error('Missing or duplicate official match row');
    rows.set(id,row);
  }
  const seen = new Set();
  const matches = [...data.groupMatches.map(m=>({...m,stage:'group'})),...data.finalMatches.map(m=>({...m,stage:'final'}))].map(m=>{
    const gameId=String(m.gameId),row=rows.get(gameId);
    if (!/^\d+$/.test(gameId) || seen.has(gameId) || !row || typeof m.isActive!=='boolean' || m.isUnrivaled!==false) throw new Error('Incomplete or unsupported official match');
    seen.add(gameId);
    const group = (m.stage==='group'?data.groups:data.finalGroups)[m.groupId];
    // Knockout schedules may have no finalGroups; retain an explicit unique bracket group.
    const groupId = group?.displayId || (m.stage==='final' && !data.finalGroups.length ? `${prefix}-KO` : null);
    if (!groupId) throw new Error('Unknown official match group');
    if (!groups.some(g=>g.id===groupId)) groups.push({id:groupId,name:'Final- og placeringskampe',stage:'final',round,source,teams:[],teamRefs:[],teamLabels:[],officialRanking:[]});
    const homeParticipant=data.participants[m.homeParticipant],awayParticipant=data.participants[m.awayParticipant];
    const homeLabel=m.sourceTeam1Display || homeParticipant?.name || homeParticipant?.sourceDisplay || homeParticipant?.displayName,awayLabel=m.sourceTeam2Display || awayParticipant?.name || awayParticipant?.sourceDisplay || awayParticipant?.displayName;
    const homeSlot=m.sourceTeam1 || homeParticipant?.source || (isQualifierLabel(homeLabel)?{type:'label',label:homeLabel}:null),awaySlot=m.sourceTeam2 || awayParticipant?.source || (isQualifierLabel(awayLabel)?{type:'label',label:awayLabel}:null);
    if (!homeLabel || !awayLabel) throw new Error('Missing official participant label');
    const home=resolveTeam(cell(row,'team-1'),homeParticipant,data,homeSlot,homeLabel),away=resolveTeam(cell(row,'team-2'),awayParticipant,data,awaySlot,awayLabel);
    const homeParticipantId=officialId(cell(row,'team-1'),m.homeParticipant,data),awayParticipantId=officialId(cell(row,'team-2'),m.awayParticipant,data);
    const homeTeamRef=home?participantRef(source,homeParticipantId):null,awayTeamRef=away?participantRef(source,awayParticipantId):null;
    const scoreText=text(cell(row,'score')),numeric=scoreText.match(/^(\d{1,3})\s*:\s*(\d{1,3})(?:\s+(?:n\.V\.|n\.E\.|aet|pens))?$/i),empty=/^[–—-]\s*:\s*[–—-]$/.test(scoreText);
    if (!numeric && !empty) throw new Error('Unsupported official score format');
    if (!/^2026-10-(?:17|18) \d{2}:\d{2}:\d{2}$/.test(m.dateAndTime)) throw new Error('Unexpected official match date');
    const start=m.dateAndTime.replace(' ','T')+'+02:00';
    if (!Number.isFinite(Date.parse(start))) throw new Error('Invalid official match time');
    const result={venue:explicitVenue(m,data.courts?.[m.courtId],source,venue),id:`${prefix}-${gameId}`,group:groupId,home,away,homeParticipantId,awayParticipantId,homeSlotRef:homeSlot?participantRef(source,m.homeParticipant):null,awaySlotRef:awaySlot?participantRef(source,m.awayParticipant):null,homeTeamRef,awayTeamRef,homeLabel,awayLabel,homeSlot,awaySlot,start,field:data.courts?.[m.courtId]?.displayId || null,homeScore:numeric?Number(numeric[1]):null,awayScore:numeric?Number(numeric[2]):null,status:numeric?'finished':'scheduled',carried:m.resultFromGroupStage===true,stage:m.stage,round,source,duration:m.stage==='final'?(durations[1] || duration):duration,scoreLabel:scoreText,knockoutLabel:m.knockoutLabel || null,withExtraTime:m.withExtraTime===true,withPenaltyShootout:m.withPenaltyShootout===true};
    const g=groups.find(g=>g.id===groupId);
    for(const ref of [homeTeamRef,awayTeamRef])if(ref && !g.teamRefs.includes(ref))g.teamRefs.push(ref);
    for(const [id,name] of [[homeParticipantId,home],[awayParticipantId,away]])if(id && name){const p=participants.find(p=>p.id===id);if(p.name && p.name!==name)throw new Error('Conflicting official assignment');p.name=name;}
    for (const name of [home,away]) if (name&&!g.teams.includes(name)) g.teams.push(name);
    for (const name of [homeLabel,awayLabel]) if (!g.teamLabels.includes(name)) g.teamLabels.push(name);
    return result;
  });
  if (rows.size!==seen.size) throw new Error('Incomplete official match list');
  // Numeric ranks are taken from the rendered official table, never inferred from local tiebreakers.
  for (const card of html.split('cp-rank-card-stack').slice(1)) {
    const index=card.match(/active(Final)?Groups\.includes\('f?(\d+)'\)/);
    if (!index) continue;
    const group=(index[1]?data.finalGroups:data.groups)[Number(index[2])];
    const g=groups.find(g=>g.id===group?.displayId); if (!g) continue;
    for (const row of card.split(/(?=<div\s+[^>]*\brole=["']row["'][^>]*>)/i).slice(1)) {
      if (!/cp-rank-row/.test(row.slice(0,row.indexOf('>')+1)) || /table-header/.test(row.slice(0,row.indexOf('>')+1))) continue;
      const rank=Number(text(cell(row,'cp-rank-cell-rank'))),content=cell(row,'cp-rank-cell-team');
      const published=resolveTeam(content,null,data,{type:'rank'},'');
      const participantId=officialId(content,null,data),teamRef=published?participantRef(source,participantId):null;
      if(teamRef && !g.teamRefs.includes(teamRef))g.teamRefs.push(teamRef);
      if(teamRef){const p=participants.find(p=>p.id===participantId);if(p.name && p.name!==published)throw new Error('Conflicting official ranking identity');p.name=published;}
      if(published){(g.publishedTeams ||= []).push(published);(g.officialRows ||= []).push({rank:Number.isInteger(rank)&&rank>0?rank:null,team:published,teamRef,...(rankingTotals(row)?{totals:rankingTotals(row)}:{})});}
      if (!Number.isInteger(rank) || rank<1) continue;
      (g.rankingSnapshot ||= []).push([...row.matchAll(/class=["']([^"']*cp-rank-cell[^"']*)["']/g)].map(item=>text(cell(row,item[1].split(/\s+/).find(name=>name.startsWith('cp-rank-cell'))))));
      const name=resolveTeam(content,null,data,{type:'rank'},'');
      if (name) g.officialRanking.push({rank,team:name,teamRef,...(rankingTotals(row)?{totals:rankingTotals(row)}:{})});
      else {
        const participantId=content.match(/filterByTeam\('\s*(\d+)\s*'\)/)?.[1];
        const participant=participantId?data.participants[participantId]:null;
        const leaves=[...content.matchAll(/<div\b[^>]*>([^<>]*)<\/div>/g)].map(m=>text(m[1])).filter(Boolean);
        const teamLabel=participant?.sourceDisplay || participant?.displayName || participant?.name || leaves.find(isQualifierLabel);
        if (teamLabel && isQualifierLabel(teamLabel)) {const entry={rank,team:null,teamLabel,slot:participant?.source || {type:'label',label:teamLabel}};g.officialRanking.push(entry);(g.officialRows ||= []).push({...entry});}
      }
    }
    if (new Set(g.officialRanking.map(r=>r.teamRef || r.team || r.teamLabel)).size!==g.officialRanking.length) throw new Error('Ambiguous official ranking participant');
  }
  for(const m of matches)for(const side of ['home','away']){
    const slot=m[side+'Slot'];
    if(!m[side] || m[side+'TeamRef'] || slot?.type!=='group' || slot.predecessor!=null)continue;
    const upstream=data.groups[slot.group],g=groups.find(g=>g.stage==='group' && g.id===upstream?.displayId);
    if(!g || !matches.filter(match=>match.group===g.id).every(match=>match.status==='finished'))continue;
    const ranked=g.officialRanking.filter(row=>row.rank===slot.rank && row.teamRef && row.team===m[side]);
    if(ranked.length!==1 || participants.filter(p=>p.name===m[side]).length!==1)continue;
    m[side+'TeamRef']=ranked[0].teamRef;
    const current=groups.find(g=>g.id===m.group);if(!current.teamRefs.includes(ranked[0].teamRef))current.teamRefs.push(ranked[0].teamRef);
  }
  for (const group of groups) {
    const fixtures=matches.filter(m=>m.group===group.id);
    group.rankingComplete=fixtures.length>0 && fixtures.every(m=>m.status==='finished' && m.home && m.away) && group.officialRanking.length===(group.teamRefs.length || group.teams.length) && group.officialRanking.every(entry=>entry.team);
  }
  return {identityVersion:1,participants,canonicalSource,predecessors,groups,matches,venue,followups,complete:true};
}

// Structured official snapshots are data, not scripts. This adapter can later be
// reused by an API transport; no API requests or cross-plan identity guesses here.
function parseStructuredTournament(data,{source,prefix,round=null},canonicalSource) {
  const fail=message=>{throw new Error(message);};
  const object=x=>x && typeof x==='object' && !Array.isArray(x);
  const integer=(x,min=0,max=999)=>Number.isInteger(x)&&x>=min&&x<=max;
  const label=x=>typeof x==='string'?text(x):null;
  // Normalize only explicit decimal integers published by the source.
  // Never coerce booleans, whitespace, signs, fractions or exponent notation.
  const officialInteger=(value,min,max,message)=>{
    const number=typeof value==='string' && /^(0|[1-9][0-9]*)$/.test(value)?Number(value):value;
    return integer(number,min,max)?number:fail(message);
  };
  if(!object(data) || !object(data.participants))fail('Invalid structured tournament');
  for(const [groupKey,matchKey] of [['groups','groupMatches'],['finalGroups','finalMatches']]) {
    if((groupKey in data && !Array.isArray(data[groupKey])) || (matchKey in data && !Array.isArray(data[matchKey])) || (data[groupKey]?.length && !Array.isArray(data[matchKey])))fail('Incomplete structured stage');
  }
  if(!Array.isArray(data.groupMatches) && !Array.isArray(data.finalMatches))fail('Missing structured matches');
  if(data.groupMatches?.length && !Array.isArray(data.groups))fail('Missing structured groups');
  const normalGroups=data.groups || [],finalGroups=data.finalGroups || [];
  const sourceLabel=slot=>{
    if(!slot || slot.type!=='group' || !integer(slot.group,0,99) || !integer(slot.rank,1,100))return null;
    const predecessor=slot.predecessor==null?null:data.predecessors?.[slot.predecessor];
    if(slot.predecessor!=null && !predecessor)fail('Unknown official predecessor');
    const group=(predecessor?.groups || normalGroups)[slot.group];
    if(!group)return null;
    return `${slot.rank}. ${label(group.name) || `Gruppe ${label(group.displayId)}`}${predecessor?` in ${label(predecessor.shortName) || 'Vorgängerturnier'}`:''}`;
  };
  const participants=Object.entries(data.participants).map(([id,p])=>{
    if(!/^\d+$/.test(id)||!object(p)||String(p.id)!==id || typeof p.name!=='string')fail('Invalid structured participant identity');
    const published=label(p.name),display=label(p.sourceDisplay)||label(p.displayName)||published||sourceLabel(p.source);
    const slot=p.source || (isQualifierLabel(display)?{type:'label',label:display}:null);
    return {id,ref:participantRef(source,id),source,name:published&&!isQualifierLabel(published)?published:null,label:display,kind:slot?'slot':'team',slot};
  });
  const byId=new Map(participants.map(p=>[p.id,p]));
  const groups=[...normalGroups.map(g=>({...g,stage:'group'})),...finalGroups.map(g=>({...g,stage:'final'}))].map(g=>({id:label(g.displayId),name:label(g.name),stage:g.stage,round,source,teams:[],teamRefs:[],teamLabels:[],officialRanking:[]}));
  if(groups.some(g=>!g.id)||new Set(groups.map(g=>g.id)).size!==groups.length)fail('Ambiguous structured groups');
  let venue;
  const location=data.location;
  if(object(location)){
    // Keep the source's published field values; do not geocode or repair them.
    const country=location.country==='DEU'?'Deutschland':label(location.country);
    const address=[label(location.name),label(location.streetnum),[label(location.zip),label(location.city)].filter(Boolean).join(' '),country].filter(Boolean).join(', ');
    venue=location.streetnum && location.city && location.zip ? venueFrom(address,'https://maps.google.com/maps?'+new URLSearchParams({q:address}),source) : {...venueFrom(address,null,source),status:'uncertain',mapUrl:null,reason:'incomplete-address'};
  }else venue={id:null,address:null,mapUrl:null,source,status:'uncertain',reason:'missing-address'};
  const seen=new Set();
  const matches=[...(data.groupMatches || []).map(m=>({...m,stage:'group'})),...(data.finalMatches || []).map(m=>({...m,stage:'final'}))].map(m=>{
    const id=String(m.gameId);
    if(!/^\d+$/.test(id)||seen.has(id)||typeof m.isActive!=='boolean'||m.isUnrivaled!==false)fail('Invalid structured match');seen.add(id);
    const list=m.stage==='group'?normalGroups:finalGroups;
    const groupId=list[m.groupId]?.displayId || (m.stage==='final'&&!finalGroups.length?`${prefix}-KO`:null);
    if(!groupId)fail('Unknown structured match group');
    if(!groups.some(g=>g.id===groupId))groups.push({id:groupId,name:'Final- og placeringskampe',stage:'final',round,source,teams:[],teamRefs:[],teamLabels:[],officialRanking:[]});
    const side=(key,slotKey,displayKey)=>{
      const raw=m[key],p=raw==null?null:byId.get(String(raw));
      if(raw!=null&&!p)fail('Unknown structured match participant');
      const slot=m[slotKey] || p?.slot || null;
      const display=label(m[displayKey]) || p?.name || p?.label || sourceLabel(slot);
      if(!display)fail('Missing structured participant label');
      return {name:p?.name || null,id:p?.id || null,ref:p?.name?p.ref:null,slot,label:display,slotRef:slot?participantRef(source,raw):null};
    };
    const home=side('homeParticipant','sourceTeam1','sourceTeam1Display'),away=side('awayParticipant','sourceTeam2','sourceTeam2Display');
    const score=v=>v==null||v===''?null:officialInteger(v,0,999,'Invalid structured score');
    const hs=score(m.score1),as=score(m.score2);if((hs===null)!==(as===null))fail('Partial structured result');
    if(!/^2026-10-(?:17|18) \d{2}:\d{2}:\d{2}$/.test(m.dateAndTime))fail('Unexpected structured match date');
    const start=m.dateAndTime.replace(' ','T')+'+02:00';if(!Number.isFinite(Date.parse(start)))fail('Invalid structured time');
    const duration=m.stage==='final'?data.finalMatchDuration:data.groupMatchDuration;
    if(duration!=null&&!integer(duration,1,180))fail('Invalid structured duration');
    // A display caption for the source's explicit placement-match mapping,
    // not a calculated team placement or qualification.
    const mapping=m.modeMapping;
    const place=mapping?.type==='knockout' && mapping.round===1 && integer(mapping.match,1,64) && integer(data.placeOffset,0,128) ? 2*mapping.match-1+data.placeOffset : null;
    const knockoutLabel=label(m.knockoutLabel) || (place===1?'Finale':place?`Spiel um ${place}. Platz`:null);
    const result={venue:explicitVenue(m,data.courts?.[m.courtId],source,venue),id:`${prefix}-${id}`,group:groupId,home:home.name,away:away.name,homeParticipantId:home.id,awayParticipantId:away.id,homeTeamRef:home.ref,awayTeamRef:away.ref,homeSlotRef:home.slotRef,awaySlotRef:away.slotRef,homeLabel:home.label,awayLabel:away.label,homeSlot:home.slot,awaySlot:away.slot,start,field:data.courts?.[m.courtId]?.displayId || null,homeScore:hs,awayScore:as,status:hs===null?'scheduled':'finished',carried:m.resultFromGroupStage===true,stage:m.stage,round,source,duration:duration??null,scoreLabel:hs===null?'– : –':`${hs} : ${as}`,knockoutLabel,withExtraTime:m.withExtraTime===true,withPenaltyShootout:m.withPenaltyShootout===true};
    const g=groups.find(g=>g.id===groupId);
    for(const s of [home,away]){if(s.ref&&!g.teamRefs.includes(s.ref))g.teamRefs.push(s.ref);if(s.name&&!g.teams.includes(s.name))g.teams.push(s.name);if(!g.teamLabels.includes(s.label))g.teamLabels.push(s.label);}
    return result;
  });
  for(const [defs,tables] of [[normalGroups,data.groupRankTables],[finalGroups,data.finalRankTables]]){
    if(!Array.isArray(tables)||tables.length!==defs.length) {if(defs.length)fail('Missing structured official tables');continue;}
    defs.forEach((def,i)=>{
      const g=groups.find(g=>g.id===def.displayId),rows=tables[i];if(!Array.isArray(rows))fail('Invalid structured table');
      const ids=new Set();
      for(const row of rows){
        if(Array.isArray(row)&&!row.length)continue;
        if(!object(row))fail('Invalid structured rank row');
        const p=byId.get(String(row.participant));
        if(row.participant!=null&&(!p||ids.has(p.id)))fail('Ambiguous structured ranking participant');if(p)ids.add(p.id);
        const rank=row.rank==null?null:officialInteger(row.rank,1,100,'Invalid structured rank');
        const totalsFields=['gameCount','ownGoalCount','opponentGoalCount','points'];
        const vals=totalsFields.map(k=>row[k]==null?null:officialInteger(row[k],0,99999,'Invalid structured ranking totals'));
        const totals=vals.every(v=>v!=null)?{played:vals[0],gf:vals[1],ga:vals[2],points:vals[3]}:null;
        if(p?.name){
          const entry={rank,team:p.name,teamRef:p.ref,...(totals?{totals}:{})};
          (g.publishedTeams ||= []).push(p.name);(g.officialRows ||= []).push(entry);
          if(!g.teamRefs.includes(p.ref))g.teamRefs.push(p.ref);
          if(rank!==null)g.officialRanking.push(entry);
        }else if(rank!==null&&p?.slot){const entry={rank,team:null,teamLabel:p.label,slot:p.slot};g.officialRanking.push(entry);(g.officialRows ||= []).push(entry);}
      }
      // Shared official ranks are valid; participant uniqueness is checked above.
    });
  }
  for(const g of groups){const fixtures=matches.filter(m=>m.group===g.id);g.rankingComplete=fixtures.length>0&&fixtures.every(m=>m.status==='finished'&&m.home&&m.away)&&g.officialRanking.length===(g.teamRefs.length||g.teams.length)&&g.officialRanking.every(r=>r.team);}
  const links=items=>{
    if(items==null)return [];if(!Array.isArray(items))fail('Invalid structured plan links');
    return items.map(item=>{const u=new URL(item.url,source);if(u.protocol!=='https:'||!['www.meinturnierplan.de','meinturnierplan.de'].includes(u.hostname)||u.username||u.password||u.port)fail('Invalid structured plan URL');return {url:u.href,title:label(item.name)||''};});
  };
  return {identityVersion:1,participants,canonicalSource,predecessors:links(data.predecessors),groups,matches,venue,followups:links(data.followups),complete:true};
}

export function parseTournamentPage(html,options={}) {
  const {source,prefix}=options;
  if(typeof html!=='string'||html.length>5_000_000||!source||!/^[A-Za-z0-9_-]+$/.test(prefix||''))throw new Error('Invalid tournament parser input');
  const classic=/window\._cpStadiumData\s*=/.test(html);
  let structured=null;
  if(/window\.preloadedState\s*=/.test(html)){
    const state=pageData(html,'preloadedState');
    if(state.tournaments || state.openTournamentId!=null){
      const id=String(state.openTournamentId),entry=state.tournaments?.[id],data=entry?.data;
      if(!/^\d+$/.test(id)||!data||String(entry.id)!==id||String(data.id)!==id||entry.slug!==data.slug||state.openTournamentSlug!==data.slug)throw new Error('Ambiguous structured tournament identity');
      const canonical=html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
      const u=new URL(source),c=canonical?new URL(text(canonical),source):null;
      if(c&&(c.protocol!=='https:'||!['www.meinturnierplan.de','meinturnierplan.de'].includes(c.hostname)||c.username||c.password))throw new Error('Invalid structured canonical source');
      if(u.pathname==='/showit.php'?u.searchParams.get('id')!==data.slug:!c||u.pathname!==c.pathname||!u.pathname.startsWith(`/c/${data.slugId}/`))throw new Error('Structured tournament source mismatch');
      structured=parseStructuredTournament(data,options,c?.href || null);
    }
  }
  if(!classic){if(!structured)throw new Error('Missing official tournament data');return structured;}
  const parsed=parseClassicPage(html,options);
  if(structured){
    const project=p=>p.matches.map(m=>Object.fromEntries(['id','group','home','away','homeParticipantId','awayParticipantId','homeTeamRef','awayTeamRef','start','field','homeScore','awayScore','carried','duration','homeSlot','awaySlot'].map(k=>[k,m[k]]))).sort((a,b)=>a.id.localeCompare(b.id));
    if(JSON.stringify(project(parsed))!==JSON.stringify(project(structured)))throw new Error('Conflicting official page formats');
    const ranks=p=>p.groups.map(g=>({id:g.id,rows:g.officialRanking}));
    if(JSON.stringify(ranks(parsed))!==JSON.stringify(ranks(structured)))throw new Error('Conflicting official standings');
    if(parsed.venue.status==='confirmed' && structured.venue.status==='confirmed' && parsed.venue.id!==structured.venue.id)throw new Error('Conflicting official venues');
    const urls=links=>links.map(l=>l.url).sort();
    for(const field of ['followups','predecessors'])if(JSON.stringify(urls(parsed[field]))!==JSON.stringify(urls(structured[field])))throw new Error('Conflicting official plan links');
  }
  return parsed;
}
