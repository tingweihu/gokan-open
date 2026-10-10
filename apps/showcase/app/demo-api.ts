"use client";
import { DEMO_PASSWORD, demoAccounts, demoNow, save, state, switchRole } from "./demo-state";

type Body = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fail = (message: string): never => { throw new Error(message); };
const number = (value: unknown) => Number(value ?? 0);
function syntheticInput(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim().startsWith("示範")) {
    fail(`${label}請使用「示範」開頭的虛構內容；請勿輸入真實資料。`);
  }
}
function syntheticEmail(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9._+-]+@gokan\.example$/i.test(value)) {
    fail("展示帳號只接受 @gokan.example 的虛構地址。");
  }
}
function find<T extends { id?: string }>(rows: T[], id: string, label: string): T {
  return rows.find(row => row.id === id) ?? fail(`找不到${label}，請重設展示。`);
}
function account() {
  const s = state();
  if (!s.role) return fail("請先登入展示系統。");
  return demoAccounts.find(item => item.email === s.role) ?? fail("展示角色無效，請重設展示。");
}
function session() {
  const s = state();
  const role = account();
  const user = s.accounts.find(item => item.email === role.email);
  const staff = role.mode === "staff";
  const onboarding=s.scenario==="onboarding";
  return { user: {...user,firstLoginRequired:onboarding&&s.onboardingStep===1},
    policy: onboarding ? s.legal[0] : null,
    consentRequired: onboarding&&s.onboardingStep===2,
    sessionAcknowledgementRequired: onboarding&&s.onboardingStep===3,
    assignments: staff ? [{ activityId: "activity-2026", role: role.role, activity: { name: s.activity.name } }] : [],
    memberships: staff ? [] : [{ organizationId: "club-1", role: role.role,
      organization: { name: s.clubs[0]!.name, activityId: "activity-2026" } }] };
}
function registration(id: string) { return find(state().registrations, id, "報名資料"); }
function team(id: string) {
  for (const reg of state().registrations) for (const entry of reg.eventEntries) {
    const found = entry.teams.find((item: Body) => item.id === id);
    if (found) return { reg, entry, found };
  }
  return fail("找不到隊伍，請重設展示。");
}
function roster(clubId: string) {
  const s=state(), club=find(s.clubs,clubId,"社團");
  const participants=s.participants.filter(p=>p.sourceOrganizationId===clubId);
  return { club, participants, total: participants.length, active: participants.filter(p=>p.active).length,
    activityStage: { status: s.activity.status, stage: s.activity.stage, reason: null } };
}
function finance(id: string) {
  const s=state(), reg=registration(id);
  const members=reg.eventEntries.flatMap((entry: Body)=>entry.teams.filter((team: Body)=>team.admissionStatus==="ADMITTED")
    .flatMap((team: Body)=>team.members.filter((m: Body)=>s.participants.some(p=>p.id===m.participantId&&p.active)).map((m: Body)=>m.participantId)));
  const participantCount=new Set(members).size;
  const fee=s.feeSchedule, baseFee=number(fee.registrationBaseFee), participantFee=number(fee.participantFee);
  const eventFees=reg.eventEntries.map((entry: Body)=>{
    const admittedTeamCount=entry.teams.filter((t: Body)=>t.admissionStatus==="ADMITTED").length;
    const pendingTeamCount=entry.teams.filter((t: Body)=>t.admissionStatus==="PENDING").length;
    const rejectedTeamCount=entry.teams.filter((t: Body)=>t.admissionStatus==="REJECTED").length;
    const unitFee=number(fee.feeOverrides.find((v: Body)=>v.eventId===entry.eventId)?.teamEntryFee ?? fee.defaultTeamEntryFee);
    return { eventId:entry.eventId,eventName:entry.event.name,teamCount:entry.teams.length,admittedTeamCount,pendingTeamCount,rejectedTeamCount,
      unitFee,subtotal:admittedTeamCount>0?unitFee:0,billed:admittedTeamCount>0,overridden:false };
  });
  const participantFeeSubtotal=participantCount*participantFee;
  const eventTeamFeeSubtotal=eventFees.reduce((n: number,item: Body)=>n+item.subtotal,0);
  const amountDue=baseFee+participantFeeSubtotal+eventTeamFeeSubtotal;
  const payments=s.payments.filter(p=>p.registrationId===id), refunds=s.refunds.filter(p=>p.registrationId===id);
  const confirmedPayments=payments.filter(p=>p.status==="CONFIRMED").reduce((n,p)=>n+number(p.amount),0);
  const completedRefunds=refunds.filter(p=>p.status==="COMPLETED").reduce((n,p)=>n+number(p.amount),0);
  const netPaid=confirmedPayments-completedRefunds;
  return { registrationId:id,status:reg.status,submittedAt:reg.submittedAt,totalRosterAttachment:reg.totalRosterAttachment,
    remittanceInstructions:s.activity.remittanceInstructions,baseFee,participantCount,participantFee,participantFeeSubtotal,
    eventTeamFeeSubtotal,eventFees,amountDue,confirmedPayments,completedRefunds,netPaid,
    balanceDue:Math.max(0,amountDue-netPaid),credit:Math.max(0,netPaid-amountDue),
    availableRefundRequest:Math.max(0,netPaid-amountDue-refunds.filter(p=>p.status==="REQUESTED").reduce((n,p)=>n+number(p.amount),0)),
    financiallyEligible:reg.status==="CONFIRMED"&&netPaid>=amountDue,
    eligibility:{registrationConfirmed:reg.status==="CONFIRMED",eligible:netPaid>=amountDue},
    payments,refunds };
}
function admissions() {
  const s=state();
  return s.events.map(event=>{
    const teams=s.registrations.flatMap(reg=>reg.eventEntries.filter((entry: Body)=>entry.eventId===event.id)
      .flatMap((entry: Body)=>entry.teams.map((item: Body)=>({ id:item.id,ordinal:item.ordinal,rowVersion:item.rowVersion,
        admissionStatus:item.admissionStatus,registrationId:reg.id,unit:reg.organization?.name??reg.league?.name??"示範報名單位",rosterSize:item.members.length }))));
    const admittedCount=teams.filter(t=>t.admissionStatus==="ADMITTED").length;
    return { id:event.id,name:event.name,teamCapacity:event.teamCapacity,admittedCount,
      pendingCount:teams.filter(t=>t.admissionStatus==="PENDING").length,
      remainingCapacity:event.teamCapacity===null?null:Math.max(0,event.teamCapacity-admittedCount),teams,
      availableRegistrations:s.registrations.filter(reg=>!reg.eventEntries.some((entry: Body)=>entry.eventId===event.id))
        .map(reg=>({id:reg.id,rowVersion:reg.rowVersion,unit:reg.organization?.name??"示範報名單位"})) };
  });
}
function dashboard() {
  const s=state(), finances=s.registrations.map(r=>finance(r.id));
  const expectedRevenue=finances.reduce((n,f)=>n+f.amountDue,0), paidRevenue=finances.reduce((n,f)=>n+f.netPaid,0);
  return { clubs:{total:s.clubs.length,loggedIn:1,registering:s.registrations.filter(r=>["DRAFT","RETURNED","SUBMITTED"].includes(r.status)).length,
    paying:finances.filter(f=>f.status==="CONFIRMED"&&!f.financiallyEligible).length,completed:finances.filter(f=>f.financiallyEligible).length},
    participants:{total:s.participants.filter(p=>p.active).length,male:s.participants.filter(p=>p.active&&p.gender==="MALE").length,
      female:s.participants.filter(p=>p.active&&p.gender==="FEMALE").length,
      grade1:s.participants.filter(p=>p.active&&p.grade==="GRADE_1").length,grade2:s.participants.filter(p=>p.active&&p.grade==="GRADE_2").length,
      grade3:s.participants.filter(p=>p.active&&p.grade==="GRADE_3").length,assignedThroughLeague:0,notAssignedThroughLeague:s.participants.length},
    finance:{expectedRevenue,paidRevenue,outstandingRevenue:Math.max(0,expectedRevenue-paidRevenue)},
    reviews:{pending:s.registrations.filter(r=>r.status==="SUBMITTED").length,returned:s.registrations.filter(r=>r.status==="RETURNED").length,
      confirmed:s.registrations.filter(r=>r.status==="CONFIRMED").length} };
}
function meetingView() {
  const s=state(), confirmed=s.registrations.filter(r=>r.status==="CONFIRMED");
  const totals=confirmed.map(r=>finance(r.id));
  const amountDue=totals.reduce((sum,item)=>sum+item.amountDue,0);
  const netPaid=totals.reduce((sum,item)=>sum+item.netPaid,0);
  return {...s.meeting,confirmedRegistrationCount:confirmed.length,
    reconciliation:{amountDue,netPaid,balanceDue:Math.max(0,amountDue-netPaid),credit:Math.max(0,netPaid-amountDue)}};
}
function leagueView(league: Body) {
  const s=state();
  const members=(league.members as Body[]).filter(member=>member.status==="CONFIRMED");
  const clubIds=new Set(members.map(member=>member.organizationId));
  const participants=s.participants.filter(p=>p.active&&clubIds.has(p.sourceOrganizationId));
  const minimum=number(s.leagueRule.minimumMemberClubs), maximum=number(s.leagueRule.maximumMemberClubs??99);
  const blockers:string[]=[];
  if(members.length<minimum)blockers.push("示範聯隊確認社團數不足。");
  if(members.length>maximum)blockers.push("示範聯隊確認社團數超過上限。");
  return {...league,eligibility:{...league.eligibility,eligible:blockers.length===0,blockers,
    participantCount:participants.length,confirmedMemberCount:members.length,
    maximumMemberClubs:maximum,maximumParticipants:s.leagueRule.maximumParticipants,
    singleGenderMemberClubs:[]}};
}
function checkInRows(eventId?: string) {
  const rows: Body[] = [];
  for (const reg of state().registrations.filter(item => item.status === "CONFIRMED")) {
    for (const entry of reg.eventEntries as Body[]) {
      if (eventId && entry.eventId !== eventId) continue;
      for (const team of entry.teams as Body[]) {
        if (team.admissionStatus !== "ADMITTED") continue;
        for (const member of team.members as Body[]) {
          const participant=find(state().participants,member.participantId,"選手");
          if(!participant.active)continue;
          rows.push({
          eventId: entry.eventId, "賽事項目": entry.event.name, "選手姓名": participant.name,
          "年級": participant.grade, "性別": participant.gender,
        });
        }
      }
    }
  }
  return rows;
}
function legal(type: string) { return state().legal.find(doc=>String(doc.documentType).toLowerCase()===type&&doc.status==="PUBLISHED") ?? fail("目前沒有展示文件。"); }

function candidates(reg: Body, entry: Body) {
  const s=state();
  const clubIds=reg.leagueId
    ? (find(s.leagues,reg.leagueId,"聯隊").members as Body[]).filter(m=>m.status==="CONFIRMED").map(m=>m.organizationId)
    : [reg.organizationId];
  return s.participants.filter(p=>p.active&&clubIds.includes(p.sourceOrganizationId)&&
    (!entry.event.genderRule||entry.event.genderRule===p.gender)&&
    (!entry.event.allowedGrades?.length||entry.event.allowedGrades.includes(p.grade)));
}
function entrySuggestion(reg: Body, entry: Body) {
  const used=new Set<string>(), blockers:string[]=[];
  const assignments=(entry.teams as Body[]).filter(t=>t.admissionStatus!=="REJECTED").map(t=>{
    const ids=(t.members as Body[]).map(m=>String(m.participantId));
    ids.forEach(id=>used.add(id));
    return {teamId:t.id,participantIds:ids};
  });
  const available=candidates(reg,entry);
  for(const assignment of assignments){
    const minimum=number(entry.event.minTeamSize??1);
    const maximum=number(entry.event.maxTeamSize??99);
    while(assignment.participantIds.length<minimum&&assignment.participantIds.length<maximum){
      const next=available.find(p=>!used.has(p.id));
      if(!next)break;
      assignment.participantIds.push(next.id);used.add(next.id);
    }
    if(assignment.participantIds.length<minimum)blockers.push(`${entry.event.name} 的隊伍缺少符合條件的示範選手。`);
  }
  return {entryId:entry.id,entryRowVersion:entry.rowVersion,
    teamRowVersions:Object.fromEntries((entry.teams as Body[]).map(t=>[t.id,t.rowVersion])),
    assignments,blockers,preservedParticipantIds:(entry.teams as Body[]).flatMap(t=>(t.members as Body[]).map(m=>m.participantId)),
    changes:assignments.some(a=>a.participantIds.length>(entry.teams as Body[]).find(t=>t.id===a.teamId)?.members.length)};
}
function applyEntrySuggestion(entry: Body, preview: Body) {
  if(preview.entryRowVersion!==entry.rowVersion)fail("隊伍資料已變更，請重新產生示範建議。");
  const reg=state().registrations.find(r=>r.eventEntries.some((e:Body)=>e.id===entry.id))!;
  const next=entrySuggestion(reg,entry);
  if(next.blockers.length)fail(next.blockers.join("；"));
  if(!next.changes)fail("目前配置已符合展示情境，無需套用。");
  for(const assignment of next.assignments){
    const team=find<Body>(entry.teams,assignment.teamId,"隊伍");
    if(preview.teamRowVersions?.[team.id]!==team.rowVersion)fail("隊伍資料已變更，請重新產生示範建議。");
    for(const id of assignment.participantIds){
      if(team.members.some((m:Body)=>m.participantId===id))continue;
      const participant=find(state().participants,id,"選手");
      team.members.push({participantId:id,participant});
      team.rowVersion++;
    }
  }
  entry.rowVersion++;
  save();
  return entry;
}
function registrationSuggestion(reg: Body) {
  const s=state();
  const entries=(reg.eventEntries as Body[]).filter(e=>e.active);
  const previews=entries.map(e=>({entry:e,preview:entrySuggestion(reg,e)}));
  const people=reg.leagueId
    ? s.participants.filter(p=>find(s.leagues,reg.leagueId,"聯隊").members.some((m:Body)=>m.organizationId===p.sourceOrganizationId))
    : s.participants.filter(p=>p.sourceOrganizationId===reg.organizationId);
  const assigned=new Set<string>();
  const events=previews.map(({entry,preview})=>{
    const teamAssignments=preview.assignments.map(a=>{
      a.participantIds.forEach(id=>assigned.add(id));
      const team=find<Body>(entry.teams,a.teamId,"隊伍");
      const current=new Set((team.members as Body[]).map(m=>m.participantId));
      return {teamId:team.id,ordinal:team.ordinal,admissionStatus:team.admissionStatus,
        willCreateTeamA:false,participantIds:a.participantIds,addedParticipantIds:a.participantIds.filter(id=>!current.has(id)),
        lockedParticipantIds:[...current],complete:a.participantIds.length>=number(entry.event.minTeamSize??1)};
    });
    const windows=s.schedules.flatMap(schedule=>schedule.status==="PUBLISHED"
      ? schedule.timeWindows.filter((w:Body)=>w.eventId===entry.eventId).map((w:Body)=>({startAt:w.startAt,endAt:w.endAt})):[]);
    return {entryId:entry.id,eventId:entry.eventId,eventName:entry.event.name,
      requiredParticipants:teamAssignments.length*number(entry.event.minTeamSize??1),
      assignedParticipants:teamAssignments.reduce((n,t)=>n+t.participantIds.length,0),
      complete:preview.blockers.length===0,willCreateTeamA:false,blockers:preview.blockers,
      lockedParticipantIds:preview.preservedParticipantIds,suggestedParticipantIds:teamAssignments.flatMap(t=>t.participantIds),
      teamAssignments,windows};
  });
  const blockers=previews.flatMap(v=>v.preview.blockers);
  const timeSlices=events.flatMap(event=>event.windows.map(window=>({
    ...window,events:[{eventId:event.eventId,eventName:event.eventName,participantCount:event.assignedParticipants}],
    simultaneousDemand:event.requiredParticipants,simultaneousAssigned:event.assignedParticipants,
    restingParticipantIds:people.filter(p=>!event.suggestedParticipantIds.includes(p.id)).map(p=>p.id)})));
  return {outcome:blockers.length?"NO_FEASIBLE_SOLUTION":"COMPLETE",registrationId:reg.id,fingerprint:"DEMO",
    registrationRowVersion:reg.rowVersion,rowVersion:reg.rowVersion,
    entryRowVersions:Object.fromEntries(entries.map(e=>[e.id,e.rowVersion])),
    teamRowVersions:Object.fromEntries(entries.flatMap(e=>(e.teams as Body[]).map(t=>[t.id,t.rowVersion]))),
    participantRowVersions:Object.fromEntries(people.map(p=>[p.id,p.rowVersion])),
    participants:people,events,blockers,warnings:["本建議只示範目前虛構資料與基本人數條件。"],
    activeParticipantCount:people.filter(p=>p.active).length,assignedParticipantCount:assigned.size,
    idleParticipantIds:people.filter(p=>!assigned.has(p.id)).map(p=>p.id),
    preservedParticipantIds:events.flatMap(e=>e.lockedParticipantIds),timeSlices,
    changes:previews.some(v=>v.preview.changes),search:{nodesVisited:0,nodeBudget:0}};
}

export async function demoApi<T>(path: string, method="GET", raw?: unknown): Promise<T> {
  const s=state(), body=(raw&&typeof raw==="object"?raw:{}) as Body;
  const [rawRoute,query]=path.split("?");
  const route=rawRoute??"", bits=route.split("/").filter(Boolean), part=(index:number)=>bits[index]??"";
  const search=new URLSearchParams(query??"");
  const done=(value: unknown, changed=false): T=>{if(changed)save();return copy(value) as T;};
  if(part(0)==="auth") {
    if(part(1)==="login"&&method==="POST") {
      const found=demoAccounts.find(item=>item.email===String(body.email??"").trim().toLowerCase());
      if(!found||body.password!==DEMO_PASSWORD) return fail("展示帳號或密碼不正確。");
      if(found.mode!==(body.entryMode??"leader")) fail("請使用符合所選入口的展示帳號。");
      switchRole(found.email);return done({ok:true});
    }
    if(part(1)==="me"&&method==="GET") return done(session());
    if(part(1)==="logout"&&method==="POST") { switchRole(null);return done({ok:true}); }
    if(["password","consent","session-acknowledgement"].includes(part(1))&&method==="POST") {
      account();
      const expected=s.onboardingStep===1?"password":s.onboardingStep===2?"consent":"session-acknowledgement";
      if(s.scenario==="onboarding"&&part(1)===expected){s.onboardingStep=Math.min(4,s.onboardingStep+1);return done({message:"展示流程已切換"},true);}
      return done({message:"此畫面僅模擬，不變更公開展示密碼或保存同意紀錄。"});
    }
  }
  if(part(0)==="legal"&&method==="GET") return done(legal(part(1)));
  account();
  if(part(0)==="activities") {
    if(part(1)!=="activity-2026") fail("展示年度不存在。");
    const op=part(2);
    if(!op) {
      if(method==="GET") return done(s.activity);
      if(method==="PATCH") {if(body.name!==undefined&&!String(body.name).includes("示範"))fail("年度名稱須標示為示範。");Object.assign(s.activity,body,{remittanceInstructions:"展示模式：不接受匯款或任何實際付款。",rowVersion:number(s.activity.rowVersion)+1});return done(s.activity,true);}
    }
    if(op==="dashboard-summary"&&method==="GET") return done(dashboard());
    if(op==="clubs") {
      if(bits.length===3&&method==="GET") return done(s.clubs);
      if(bits.length===3&&method==="POST") {syntheticInput(body.name,"社團名稱");const row={id:`club-${s.clubs.length+1}`,activityId:s.activity.id,rowVersion:1,...body};s.clubs.push(row);return done(row,true);}
      if(part(3)) {const club=find(s.clubs,part(3),"社團");
        if(part(4)==="league-qualification") {const people=s.participants.filter(p=>p.sourceOrganizationId===club.id&&p.active);
          const male=people.filter(p=>p.gender==="MALE").length,female=people.length-male;
          return done({eligible:true,participantCount:people.length,genderCounts:{male,female},
            minorityGenderRatio:people.length?Math.round(Math.min(male,female)/people.length*100):0,checks:[],blockers:[]});}
        if(method==="PATCH") {if(body.name!==undefined)syntheticInput(body.name,"社團名稱");Object.assign(club,body,{rowVersion:number(club.rowVersion)+1});return done(club,true);}
      }
    }
    if(op==="accounts") {
      if(bits.length===3&&method==="GET") return done(s.accounts);
      if(bits.length===3&&method==="POST") {
        syntheticInput(body.displayName,"帳號名稱");syntheticEmail(body.email);
        const assigned=body.assignment?.kind==="club"&&body.assignment.organizationId
          ? find(s.clubs,String(body.assignment.organizationId),"社團"):null;
        const row={id:`account-${s.accounts.length+1}`,email:body.email,displayName:body.displayName,
          status:"ACTIVE",firstLoginRequired:false,
          organizationMemberships:assigned?[{organizationId:assigned.id,organization:assigned,
            role:body.assignment.role==="DEPUTY"?"DEPUTY":"LEADER",revokedAt:null}]:[],
          staffAssignments:[]};
        s.accounts.push(row);return done(row,true);
      }
      if(["bulk-preview","bulk-commit"].includes(part(3))&&method==="POST") {
        const rows=Array.isArray(body.rows)?body.rows as Body[]:[];
        const valid=rows.filter(row=>typeof row.clubName==="string"&&row.clubName.startsWith("示範")&&
          typeof row.leaderEmail==="string"&&row.leaderEmail.endsWith("@gokan.example")&&
          typeof row.leaderName==="string"&&row.leaderName.startsWith("示範")&&
          (!row.deputyName||String(row.deputyName).startsWith("示範"))&&
          (!row.deputyEmail||/^[a-z0-9._+-]+@gokan\.example$/i.test(String(row.deputyEmail))));
        if(part(3)==="bulk-preview")return done({total:rows.length,valid:valid.length,invalid:rows.length-valid.length,
          errors:valid.length===rows.length?[]:[{row:1,message:"僅接受帶有示範名稱與 @gokan.example 的虛構資料。"}],canCommit:valid.length===rows.length&&valid.length>0,
          fingerprint:"DEMO",rows});
        if(valid.length!==rows.length||!valid.length||body.fingerprint!=="DEMO")fail("示範帳號資料未通過檢查。");
        for(const row of valid) {const club={id:`club-${s.clubs.length+1}`,code:row.clubCode,name:row.clubName,shortName:row.clubShortName??null,active:true,rowVersion:1,activityId:s.activity.id};
          s.clubs.push(club);s.accounts.push({id:`account-${s.accounts.length+1}`,email:row.leaderEmail,displayName:row.leaderName,status:"ACTIVE",firstLoginRequired:false,
            organizationMemberships:[{organizationId:club.id,role:"LEADER",organization:club}],staffAssignments:[]});
          if(row.deputyEmail)s.accounts.push({id:`account-${s.accounts.length+1}`,email:row.deputyEmail,displayName:row.deputyName,status:"ACTIVE",firstLoginRequired:false,
            organizationMemberships:[{organizationId:club.id,role:"DEPUTY",organization:club}],staffAssignments:[]});}
        const csv="\ufeff示範社團,示範領隊帳號,示範副領隊帳號\r\n"+valid.map(row=>`${row.clubName},${row.leaderEmail},${row.deputyEmail??""}`).join("\r\n")+"\r\n";
        const base64=btoa(Array.from(new TextEncoder().encode(csv),byte=>String.fromCharCode(byte)).join(""));
        return done({count:valid.length,file:{name:"DEMO-accounts.csv",mime:"text/csv",base64}},true);
      }
      if(part(3)) {const row=find(s.accounts,part(3),"帳號");
        if(part(4)==="assignment"&&method==="POST") {
          const member=row.organizationMemberships?.find((item:Body)=>item.organizationId===body.assignment?.organizationId);
          if(!member)fail("找不到示範社團成員。");
          member.revokedAt=body.revoked?new Date(demoNow()).toISOString():null;
          return done(row,true);
        }
        if(method==="PATCH") {if(body.displayName!==undefined)syntheticInput(body.displayName,"帳號名稱");if(body.email!==undefined)syntheticEmail(body.email);
          const allowed:Body={};for(const field of ["displayName","email","status"])if(body[field]!==undefined)allowed[field]=body[field];
          Object.assign(row,allowed);return done(row,true);}
      }
    }
    if(op==="events") {
      if(bits.length===3&&method==="GET") return done(s.events);
      if(bits.length===3&&method==="POST") {syntheticInput(body.name,"賽事名稱");const row={id:`event-${s.events.length+1}`,rowVersion:1,...body};s.events.push(row);return done(row,true);}
      if(part(3)) {const row=find(s.events,part(3),"賽事");if(method==="PATCH") {if(body.name!==undefined)syntheticInput(body.name,"賽事名稱");Object.assign(row,body,{rowVersion:number(row.rowVersion)+1});return done(row,true);}
        if(method==="DELETE") {if(s.registrations.some(reg=>reg.eventEntries.some((e: Body)=>e.eventId===row.id))) fail("已有展示報名資料的賽事不可刪除。");s.events=s.events.filter(e=>e.id!==row.id);return done({ok:true},true);}}
    }
    if(op==="competition-builder-state") return done({locked:false,registrationStarted:false,meaningfulDependency:false});
    if(op==="event-template"&&method==="POST") fail("展示年度已有賽事項目；請直接編輯現有賽事。");
    if(op==="schedules") {
      if(bits.length===3&&method==="GET") return done(s.schedules);
      if(bits.length===3&&method==="POST") {const row={id:`schedule-${s.schedules.length+1}`,version:s.schedules.length+1,status:"DRAFT",rowVersion:1,timeWindows:[]};s.schedules.push(row);return done(row,true);}
    }
    if(op==="fee-schedule"&&method==="GET") return done(s.feeSchedule);
    if(op==="fee-configuration"&&method==="PATCH") {
      if (demoNow() >= Date.parse(String(s.activity.registrationOpensAt))) fail("報名已開始，收費設定已鎖定。");
      if (number(body.rowVersion) !== number(s.feeSchedule.rowVersion)) fail("收費設定已更新，請重新整理後再試。");
      for (const key of ["registrationBaseFee", "participantFee", "defaultTeamEntryFee"]) {
        if (!Number.isSafeInteger(body[key]) || body[key] < 0) fail("收費設定必須是非負整數。");
      }
      if (!Array.isArray(body.overrides) || body.overrides.some((item: Body) =>
        !s.events.some(event => event.id === item.eventId) || !Number.isSafeInteger(item.teamEntryFee) || item.teamEntryFee < 0)) {
        fail("賽事項目費設定無效。");
      }
      Object.assign(s.feeSchedule, {
        registrationBaseFee: body.registrationBaseFee,
        participantFee: body.participantFee,
        defaultTeamEntryFee: body.defaultTeamEntryFee,
        feeOverrides: body.overrides.map((item: Body) => ({ eventId: item.eventId, teamEntryFee: item.teamEntryFee })),
        rowVersion: number(s.feeSchedule.rowVersion) + 1,
      });
      return done(s.feeSchedule,true);
    }
    if(op==="league-rule") {if(method==="GET")return done(s.leagueRule);if(method==="PATCH"){Object.assign(s.leagueRule,body,{rowVersion:number(s.leagueRule.rowVersion)+1});return done(s.leagueRule,true);}}
    if(op==="leagues") {if(bits.length===3&&method==="GET")return done(s.leagues.map(leagueView));
      if(bits.length===3&&method==="POST") {syntheticInput(body.name,"聯隊名稱");const row={id:`league-${s.leagues.length+1}`,members:[],eligibility:{eligible:false,blockers:[],participantCount:0,confirmedMemberCount:0},status:"PENDING_CONFIRMATION",rowVersion:1,...body};s.leagues.push(row);return done(row,true);}
      if(part(3)&&part(4)==="registrations"&&method==="POST")return done(makeRegistration(part(3),true),true);
    }
    if(op==="registrations") {if(bits.length===3&&method==="GET")return done(account().mode==="staff"?s.registrations:s.registrations.filter(reg=>reg.organizationId==="club-1"||reg.league?.ownerOrganizationId==="club-1"));
      if(bits.length===3&&method==="POST")return done(makeRegistration(String(body.organizationId),false),true);}
    if(op==="registration-review"&&method==="GET") return done(s.registrations.filter(r=>r.status==="SUBMITTED"));
    if(op==="event-admissions"&&method==="GET")return done(admissions());
    if(op==="payment-review"&&method==="GET")return done(s.payments.filter(p=>p.status==="SUBMITTED").map(p=>({...p,registration:registration(p.registrationId)})));
    if(op==="refund-review"&&method==="GET")return done(s.refunds.filter(r=>r.status==="REQUESTED").map(r=>({...r,registration:registration(r.registrationId)})));
    if(op==="leader-meeting") {if(bits.length===3&&method==="GET")return done(meetingView());
      if(part(3)==="admissions"&&method==="POST") {const reg=registration(String(body.registrationId)),event=find(s.events,String(body.eventId),"賽事");
        if(reg.eventEntries.some((e: Body)=>e.eventId===event.id))fail("這個報名單位已加入賽事。");
        const entry={id:`entry-demo-${crypto.randomUUID()}`,eventId:event.id,event,active:true,rowVersion:1,source:"LEADER_MEETING",teams:[{id:`team-demo-${crypto.randomUUID()}`,ordinal:1,rowVersion:1,admissionStatus:"PENDING",members:[]}]};
        reg.eventEntries.push(entry);return done(entry,true);}
      if(method==="POST") {const next:{[key:string]:string}={start:"ENTRY_OPEN","close-entry":"ENTRY_CLOSED_PARTICIPANT_OPEN",close:"CLOSED"};
        const status=next[part(3)];if(!status)fail("展示會議操作未提供。");s.meeting.status=status;s.meeting.rowVersion++;
        if(status==="CLOSED")s.meeting.final={amountDue:dashboard().finance.expectedRevenue,capturedAt:new Date(demoNow()).toISOString()};
        return done(meetingView(),true);}}
    if(op==="check-in"&&method==="GET")return done(checkInRows(search.get("eventId")??undefined));
    if(op==="final-pack"&&method==="GET") {const rows=s.registrations.filter(reg=>reg.status==="CONFIRMED")
      .flatMap(reg=>reg.eventEntries.flatMap((entry:Body)=>entry.teams.filter((team:Body)=>team.admissionStatus==="ADMITTED")
        .flatMap((team:Body)=>team.members.map((member:Body)=>{
          const participant=find(s.participants,member.participantId,"選手");
          return {participant:participant.name,sourceClub:participant.sourceOrganization?.name??"示範社團",
            grade:participant.grade,gender:participant.gender,event:entry.event.name,
            team:team.ordinal===1?"A 隊":"B 隊"};
        }))));
      return done({available:s.meeting.status==="CLOSED",message:"請切換至領隊會議／會後展示情境。",rows});}
    if(op==="leader-timetable"&&method==="GET")return done({items:s.schedules.flatMap(schedule=>schedule.timeWindows.map((window: Body)=>({startAt:window.startAt,endAt:window.endAt,venue:window.venue,event:window.event.name,unit:"示範海風社",teams:[]})))});
    if(op==="legal") {if(bits.length===3&&method==="GET")return done(s.legal);
      if(bits.length===3&&method==="POST") {syntheticInput(body.title,"文件標題");syntheticInput(body.bodyMarkdown,"文件內容");const row={id:`demo-policy-${s.legal.length+1}`,status:"DRAFT",publishedAt:null,...body};s.legal.push(row);return done(row,true);}
      if(part(4)==="publish"&&method==="POST") {const doc=find(s.legal,part(3),"示範文件");doc.status="PUBLISHED";doc.publishedAt=new Date(demoNow()).toISOString();return done(doc,true);}}
  }
  if(part(0)==="clubs"&&part(2)==="roster") {
    const clubId=part(1);
    if(bits.length===3&&method==="GET")return done(roster(clubId));
    if(bits.length===3&&method==="POST") {syntheticInput(body.name,"選手姓名");const club=find(s.clubs,clubId,"社團"),row={id:`participant-${s.participants.length+1}`,activityId:s.activity.id,sourceOrganizationId:clubId,sourceOrganization:club,active:true,rowVersion:1,...body};s.participants.push(row);return done(row,true);}
    if(part(3)==="template"&&method==="GET")fail("請使用展示內建的示範名單，不下載正式匯入範本。");
    if(part(3)==="import") {
      if(body.file?.name!=="DEMO-roster.csv")fail("請使用展示內建的示範名單。");
      const rows=Array.from({length:3},(_,index)=>({name:`示範匯入選手 ${String(s.participants.length+index+1).padStart(3,"0")}`,
        gender:index%2?"FEMALE":"MALE",grade:`GRADE_${index+1}`}));
      if(part(4)==="preview")return done({totalRows:3,validRows:3,invalidRows:0,errors:[],rows});
      if(part(4)==="commit") {const club=find(s.clubs,clubId,"社團");for(const row of rows)s.participants.push({id:`participant-${s.participants.length+1}`,activityId:s.activity.id,
        sourceOrganizationId:clubId,sourceOrganization:club,active:true,rowVersion:1,...row});club.rowVersion++;return done({count:rows.length},true);}
    }
    if(part(3)&&method==="PATCH") {const row=find(s.participants,part(3),"選手");if(body.name!==undefined)syntheticInput(body.name,"選手姓名");Object.assign(row,body,{rowVersion:number(row.rowVersion)+1});for(const reg of s.registrations)for(const entry of reg.eventEntries)for(const team of entry.teams)for(const member of team.members)if(member.participantId===row.id)member.participant=row;return done(row,true);}
  }
  if(part(0)==="leagues"&&part(1)) {
    const league=find(s.leagues,part(1),"聯隊");
    if(bits.length===2&&method==="GET")return done(leagueView(league));
    if(part(2)==="participants"&&method==="GET")return done(s.participants.filter(p=>league.members.some((m: Body)=>m.organizationId===p.sourceOrganizationId)));
    if(part(2)==="members"&&method==="POST") {const club=find(s.clubs,String(body.organizationId),"社團");const row={id:`league-member-${crypto.randomUUID()}`,organizationId:club.id,organization:club,status:"PENDING"};league.members.push(row);return done(leagueView(league),true);}
    if(part(2)==="members"&&part(3)&&method==="POST") {const member=find<Body>(league.members,part(3),"聯隊成員");member.status="CONFIRMED";return done(leagueView(league),true);}
    if(method==="PATCH") {if(body.name!==undefined)syntheticInput(body.name,"聯隊名稱");Object.assign(league,body,{rowVersion:number(league.rowVersion)+1});return done(leagueView(league),true);}
  }
  if(part(0)==="registrations"&&part(1)) {
    const reg=registration(part(1));
    if(bits.length===2&&method==="GET")return done(reg);
    if(part(2)==="finance"&&method==="GET")return done(finance(reg.id));
    if(part(2)==="roster-submit"&&method==="POST") {reg.submittedAt=new Date(demoNow()).toISOString();reg.rowVersion++;return done(reg,true);}
    if(part(2)==="submit"&&method==="POST") {if(!reg.totalRosterAttachment)fail("請先使用示範總名單。");reg.status="SUBMITTED";reg.submittedAt??=new Date(demoNow()).toISOString();reg.rowVersion++;return done(reg,true);}
    if(["return","confirm"].includes(part(2))&&method==="POST") {if(reg.status!=="SUBMITTED")fail("目前報名狀態不可審核。");if(part(2)==="return")syntheticInput(body.reason,"退回原因");reg.status=part(2)==="return"?"RETURNED":"CONFIRMED";reg.returnReason=part(2)==="return"?String(body.reason):null;reg.rowVersion++;return done(reg,true);}
    if(part(2)==="events") {if(method==="POST") {const event=find(s.events,String(body.eventId),"賽事");if(reg.eventEntries.some((e: Body)=>e.eventId===event.id))fail("賽事已加入。");const row={id:`entry-${crypto.randomUUID()}`,eventId:event.id,event,active:true,rowVersion:1,source:"REGISTRATION",teams:[]};reg.eventEntries.push(row);reg.rowVersion++;return done(row,true);}
      if(part(3)&&method==="DELETE") {reg.eventEntries=reg.eventEntries.filter((e: Body)=>e.eventId!==part(3));reg.rowVersion++;return done(reg,true);}}
    if(part(2)==="payments"&&method==="POST") {const row={id:`payment-${s.payments.length+1}`,registrationId:reg.id,amount:number(body.amount),status:"SUBMITTED",paidAt:body.paidAt,
      payerName:body.payerName?"示範付款人":null,reference:body.reference?"DEMO-REFERENCE":null,rowVersion:1,submittedBy:s.accounts.find(a=>a.email===s.role),attachment:null};
      if(row.amount<=0)fail("請輸入大於零的示範金額。");s.payments.push(row);return done(row,true);}
    if(part(2)==="refunds"&&method==="POST") {syntheticInput(body.reason,"退款原因");const amount=number(body.amount);if(amount<=0||amount>finance(reg.id).availableRefundRequest)fail("示範退款金額超過可申請額度。");const row={id:`refund-${s.refunds.length+1}`,registrationId:reg.id,amount,reason:String(body.reason),status:"REQUESTED",rowVersion:1};s.refunds.push(row);return done(row,true);}
    if(part(2)==="total-roster-demo"&&method==="POST") {const attachment={id:`attachment-${reg.id}`,originalName:"示範總名單.pdf",mimeType:"application/pdf",sizeBytes:1000,createdAt:new Date(demoNow()).toISOString()};reg.totalRosterAttachment=attachment;return done(attachment,true);}
    if(part(2)==="payment-proof-demo"&&method==="POST") return done({id:`proof-${reg.id}`,originalName:"示範付款資料.txt",mimeType:"text/plain",sizeBytes:100,createdAt:new Date(demoNow()).toISOString()});
    if(["payment-proof","total-roster"].includes(part(2))&&method==="POST")fail("展示站不讀取外部檔案；請使用示範檔案。");
    if(part(2)==="roster-suggestion"&&method==="POST") {
      if(part(3)==="apply") {
        if(body.fingerprint!=="DEMO"||body.registrationRowVersion!==reg.rowVersion)fail("展示資料已變更，請重新產生配置建議。");
        const preview=registrationSuggestion(reg);
        if(preview.blockers.length||!preview.changes)fail("目前沒有可套用的示範配置變更。");
        const toApply=(reg.eventEntries as Body[]).filter(entry=>entry.active)
          .map(entry=>({entry,proposal:entrySuggestion(reg,entry)}));
        for(const {entry,proposal} of toApply){
          if(body.entryRowVersions?.[entry.id]!==entry.rowVersion||proposal.blockers.length)fail("展示資料已變更，請重新產生配置建議。");
          for(const team of entry.teams as Body[])if(body.teamRowVersions?.[team.id]!==team.rowVersion)fail("隊伍資料已變更，請重新產生配置建議。");
        }
        for(const {entry,proposal} of toApply)if(proposal.changes){
          applyEntrySuggestion(entry,{entryRowVersion:body.entryRowVersions[entry.id],teamRowVersions:body.teamRowVersions});
        }
        reg.rowVersion++;return done(reg,true);
      }
      return done(registrationSuggestion(reg));
    }
  }
  if(part(0)==="payments"&&part(1)&&method==="POST") {const payment=find(s.payments,part(1),"付款資料");if(payment.status!=="SUBMITTED")fail("這筆示範付款已處理。");
    payment.status=part(2)==="confirm"?"CONFIRMED":"REJECTED";payment.receivedAmount=body.receivedAmount??payment.amount;payment.rowVersion++;return done(payment,true);}
  if(part(0)==="refunds"&&part(1)&&method==="POST") {const refund=find(s.refunds,part(1),"退款資料");refund.status=part(2)==="complete"?"COMPLETED":"CANCELLED";refund.rowVersion++;return done(refund,true);}
  if(part(0)==="event-entries"&&part(1)) {const entry=s.registrations.flatMap(r=>r.eventEntries).find((e: Body)=>e.id===part(1))??fail("找不到賽事報名。");
    if(part(2)==="teams"&&method==="POST") {if(entry.teams.length>=number(entry.event.maxTeamsPerRegistration))fail("已達此賽事最多隊伍數。");const row={id:`team-${crypto.randomUUID()}`,ordinal:entry.teams.length+1,rowVersion:1,admissionStatus:"PENDING",members:[]};entry.teams.push(row);entry.rowVersion++;return done(row,true);}
    if(part(2)==="roster-suggestion"&&method==="POST") {
      if(part(3)==="apply")return done(applyEntrySuggestion(entry,{entryRowVersion:body.rowVersion,teamRowVersions:body.teamRowVersions}),true);
      const reg=s.registrations.find(r=>r.eventEntries.some((e:Body)=>e.id===entry.id))!;
      return done(entrySuggestion(reg,entry));
    }
  }
  if(part(0)==="teams") {
    if(part(1)==="move-member"&&method==="POST") {const from=team(String(body.fromTeamId)).found,to=team(String(body.toTeamId)).found;
      const member=from.members.find((m: Body)=>m.participantId===body.participantId)??fail("找不到隊員。");if(to.members.some((m: Body)=>m.participantId===member.participantId))fail("隊員已在目標隊伍。");from.members=from.members.filter((m: Body)=>m!==member);to.members.push(member);from.rowVersion++;to.rowVersion++;return done({ok:true},true);}
    if(part(1)==="replace-member"&&method==="POST") {const found=team(String(body.teamId)).found,member=found.members.find((m: Body)=>m.participantId===body.participantId)??fail("找不到隊員。");const p=find(s.participants,String(body.replacementParticipantId),"替補選手");member.participantId=p.id;member.participant=p;found.rowVersion++;return done(found,true);}
    const item=team(part(1)),t=item.found;
    if(["admit","reject"].includes(part(2))&&method==="POST") {if(part(2)==="admit"){const event=item.entry.event,admitted=admissions().find(a=>a.id===event.id)?.admittedCount??0;
      if(event.teamCapacity!==null&&admitted>=event.teamCapacity)fail("示範賽事名額已滿。");}t.admissionStatus=part(2)==="admit"?"ADMITTED":"REJECTED";t.rowVersion++;return done(t,true);}
    if(part(2)==="members"&&method==="POST") {const p=find(s.participants,String(body.participantId),"選手");if(t.members.some((m: Body)=>m.participantId===p.id))fail("選手已在隊伍中。");
      if(t.members.length>=number(item.entry.event.maxTeamSize??99))fail("隊伍已滿額。");t.members.push({participantId:p.id,participant:p});t.rowVersion++;return done(t,true);}
    if(part(2)==="members"&&part(3)&&method==="DELETE") {t.members=t.members.filter((m: Body)=>m.participantId!==part(3));t.rowVersion++;return done(t,true);}
  }
  if(part(0)==="schedules"&&part(1)) {const row=find(s.schedules,part(1),"時程");
    if(part(2)==="impact"&&method==="GET")return done({conflictCount:0,conflicts:[]});
    if(part(2)==="publish"&&method==="POST") {s.schedules.forEach(x=>{if(x.status==="PUBLISHED")x.status="ARCHIVED";});row.status="PUBLISHED";row.rowVersion++;return done(row,true);}
    if(part(2)==="windows") {if(bits.length===3&&method==="POST") {const event=find(s.events,String(body.eventId),"賽事");const window={id:`window-${crypto.randomUUID()}`,event,...body};row.timeWindows.push(window);row.rowVersion++;return done(window,true);}
      const window=find(row.timeWindows,part(3),"時段");if(method==="PATCH") {Object.assign(window,body);row.rowVersion++;return done(window,true);}
      if(method==="DELETE") {row.timeWindows=row.timeWindows.filter((w: Body)=>w.id!==window.id);row.rowVersion++;return done({ok:true},true);}}
  }
  return fail(`此展示操作尚未提供：${method} ${route}`);
}

function makeRegistration(unitId: string, league: boolean) {
  const s=state(), organization=league?null:find(s.clubs,unitId,"社團"), leagueRow=league?find(s.leagues,unitId,"聯隊"):null;
  const exists=s.registrations.find(r=>league?r.leagueId===unitId:r.organizationId===unitId);
  if(exists)fail("這個單位已有展示報名。");
  const row={id:`registration-${s.registrations.length+1}`,activityId:s.activity.id,organizationId:organization?.id??null,organization,
    leagueId:leagueRow?.id??null,league:leagueRow,status:"DRAFT",rowVersion:1,writable:true,createdAt:new Date(demoNow()).toISOString(),submittedAt:null,
    totalRosterAttachment:null,eventEntries:[],validation:{blockers:[],warnings:[]}};
  s.registrations.push(row);save();return row;
}
