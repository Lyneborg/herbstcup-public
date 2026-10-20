// A participant ID identifies one registration/slot in one official plan.
export function sourceKey(value) {
  try {const u=new URL(value);u.searchParams.delete('setlang');u.hash='';return u.href.replace(/\/$/,'');}catch{return null;}
}
export function participantRef(source,id) {
  return /^\d+$/.test(String(id)) && sourceKey(source)?`mtp:${encodeURIComponent(sourceKey(source))}:${id}`:null;
}
export const ISHOJ_REF=participantRef('https://www.meinturnierplan.de/showit.php?id=24oqfztx3t','6115259');
const nameKey=value=>String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();

/** Join only explicit official slot references with published assignments and an official rank.
 * This checks identity, never fills a participant, calculates ranks or changes source values. */
export function officialIdentities(tournament) {
  const pages=tournament.identityPages || [];
  const aliases={},labels={},links=[],issues=[];
  const lookup=new Map();
  for(const page of pages){
    for(const url of [page.source,page.canonicalSource].filter(Boolean)){
      const key=sourceKey(url);lookup.set(key,lookup.has(key)&&lookup.get(key)!==page?null:page);
    }
    for(const p of page.participants || [])if(p.name){labels[p.ref]=p.name;aliases[p.ref]=p.ref;}
  }
  const uniqueGroup=(id)=>{
    // The first Sunday phase publishes references to Saturday final groups. IDs reused
    // in Sunday's own finals must not become candidates for that official reference.
    const pool=pages.some(page=>page.saturday)?pages.filter(page=>page.saturday):pages;
    const found=pool.flatMap(page=>(page.groups || []).filter(g=>g.id===id || g.name===`Gruppe ${id}`).map(group=>({page,group})));
    if(found.length!==1)return null;
    const target=found[0];
    if(target.group.id!==id || (target.group.name && target.group.name!==`Gruppe ${id}`))return null;
    return target;
  };
  for(const child of pages)for(const p of child.participants || []){
    if(!p.name || !p.slot)continue;
    let target=null;
    if(p.slot.type==='group' && Number.isInteger(p.slot.predecessor)){
      const parent=lookup.get(sourceKey(child.predecessors?.[p.slot.predecessor]?.url));
      const group=(parent?.groups || []).filter(g=>g.stage==='group')[p.slot.group];
      if(parent&&group)target={page:parent,group,rank:p.slot.rank};
    }else if(p.slot.type==='label'){
      // This label is published by the source, not inferred from a matching name.
      const match=/^([1-9])\. Gruppe ([A-Za-z0-9_-]+)$/.exec(p.slot.label || '');
      const found=match?uniqueGroup(match[2]):null;if(found)target={...found,rank:Number(match[1])};
    }
    if(!target)continue;
    const {page:parent,group,rank}=target;
    if(tournament.separateDays){const dates=page=>[...new Set((page.matches || []).map(m=>m.start?.slice(0,10)).filter(Boolean))];const before=dates(parent),after=dates(child);if(before.length!==1 || after.length!==1 || before[0]!==after[0])continue;}
    if(!group.rankingComplete || group.rankingPending || group.rankingStale || child.stale || parent.stale)continue;
    const ranked=(group.officialRanking || []).filter(row=>row.rank===rank && row.teamRef);
    if(ranked.length!==1)continue;
    const row=ranked[0];
    // Duplicate literal names cannot establish which registration was assigned.
    const names=(parent.participants || []).filter(item=>item.name && nameKey(item.name)===nameKey(p.name));
    if(nameKey(row.team)!==nameKey(p.name) || names.length!==1){
      issues.push({code:'identity-assignment-mismatch',message:'Den offentliggjorte holdtilknytning kan ikke bekræftes mod den officielle forgængerplan. Se den officielle plan.',teams:[p.ref,row.teamRef],sources:[child.source,parent.source],matchIds:(child.matches || []).filter(m=>[m.homeTeamRef,m.awayTeamRef].includes(p.ref)).map(m=>m.id)});continue;
    }
    if(p.ref===row.teamRef)continue;
    links.push({from:p.ref,to:row.teamRef,source:child.source,previousSource:parent.source,group:group.id,rank});
  }
  const edges=new Map();for(const link of links){if(edges.has(link.from)&&edges.get(link.from)!==link.to)edges.set(link.from,null);else edges.set(link.from,link.to);}
  const root=ref=>{const seen=new Set();let cursor=ref;while(edges.has(cursor)){if(seen.has(cursor)||!edges.get(cursor))return ref;seen.add(cursor);cursor=edges.get(cursor);}return cursor;};
  for(const ref of Object.keys(aliases))aliases[ref]=root(ref);
  return {version:1,aliases,labels,links,issues};
}

/** UI uses refs for comparisons; all text, scores and tables remain source values. */
export function identityView(data) {
  if(data.identityProjected || !data.identity)return data;
  const out=structuredClone(data),identity=out.identity;
  const canonical=ref=>ref?(identity.aliases[ref] || ref):null;
  const match=m=>{for(const side of ['home','away']){m[side+'Name']=m[side];m[side]=canonical(m[side+'TeamRef']);}return m;};
  const group=g=>{g.teams=[...new Set((g.teamRefs || []).map(canonical).filter(Boolean))];g.publishedTeams=g.teams;for(const rows of [g.officialRanking,g.officialRows])for(const row of rows || []){row.teamName=row.team;row.teamLabel ||= row.team;row.team=canonical(row.teamRef);}return g;};
  out.groups.forEach(group);out.matches.forEach(match);
  for(const stage of out.stages || []){stage.groups.forEach(group);stage.matches.forEach(match);}
  for(const m of out.removedMatches || [])match(m);
  for(const item of out.missingTeams || []){item.teamName=item.team;item.team=canonical(item.teamRef);}
  for(const issue of out.conflicts || [])issue.teams=(issue.teamRefs || issue.teams || []).filter(ref=>String(ref).startsWith('mtp:')).map(canonical);
  out.conflicts=[...(out.conflicts || []),...(identity.issues || []).map(issue=>({...issue,teams:issue.teams.map(canonical)}))];
  out.identityProjected=true;return out;
}
