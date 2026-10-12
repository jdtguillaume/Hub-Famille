const {onSchedule}=require('firebase-functions/v2/scheduler');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getMessaging}=require('firebase-admin/messaging');
const {defineString}=require('firebase-functions/params');
const crypto=require('crypto');
const CAL=defineString('CALENDAR_ID',{default:''});
initializeApp();
const db=getFirestore(),TZ='Europe/Paris',REGION='europe-west1',NAMES={g:'Guillaume',p:'Pauline'};
const now=()=>process.env.FAKE_NOW?new Date(process.env.FAKE_NOW):new Date();
function paris(d){const o={};new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(p=>o[p.type]=p.value);return{date:o.year+'-'+o.month+'-'+o.day,h:+o.hour,m:+o.minute}}
const dayNum=s=>Math.round(Date.parse(s+'T00:00:00Z')/864e5);
const add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const addM=(s,n)=>{const [y,m,k]=s.split('-').map(Number),f=new Date(Date.UTC(y,m-1+n,1)),last=new Date(Date.UTC(f.getUTCFullYear(),f.getUTCMonth()+1,0)).getUTCDate();f.setUTCDate(Math.min(k,last));return f.toISOString().slice(0,10)};
const diffD=(a,b)=>dayNum(b)-dayNum(a);
function nextTk(t,T){if(!t.d)return null;if(!t.r||t.r==='0'||t.d>=T)return t.d;if(t.r==='w')return add(t.d,7*Math.ceil(diffD(t.d,T)/7));const n=t.r==='m'?1:12,k=Math.floor(((+T.slice(0,4)-+t.d.slice(0,4))*12+(+T.slice(5,7)-+t.d.slice(5,7)))/n);let r=addM(t.d,k*n);if(r<T)r=addM(t.d,(k+1)*n);return r}
function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=(h+l-7*m+114)%31+1;return y+'-'+String(mo).padStart(2,'0')+'-'+String(da).padStart(2,'0')}
function ferie(T){const y=+T.slice(0,4),E=easter(y),o={};o[y+'-01-01']="Jour de l'an";o[add(E,1)]='Lundi de Pâques';o[y+'-05-01']='Fête du Travail';o[y+'-05-08']='Victoire 1945';o[add(E,39)]='Ascension';o[add(E,50)]='Lundi de Pentecôte';o[y+'-07-14']='Fête nationale';o[y+'-08-15']='Assomption';o[y+'-11-01']='Toussaint';o[y+'-11-11']='Armistice 1918';o[y+'-12-25']='Noël';return o[T]}
function buildSummary(w,ag,T){const L=[],f=ferie(T);if(f)L.push('🎉 '+f);
const ev=(ag.ev||[]).filter(e=>e.d<=T&&T<=(e.e&&e.e>=e.d?e.e:e.d)&&(e.w===w||e.w==='c'));
ev.filter(e=>!e.s).forEach(e=>L.push('📌 '+e.t+' (journée entière)'));
ev.filter(e=>e.s).sort((a,b)=>a.s.localeCompare(b.s)).forEach(e=>L.push('🕒 '+e.s+' '+e.t));
(ag.tk||[]).filter(t=>!t.x&&(t.w===w||t.w==='c')).forEach(t=>{const n=nextTk(t,T);if(n&&n<=T)L.push('✅ '+t.t+(n<T?' (en retard)':''))});
(ag.bd||[]).filter(b=>b.d&&b.d.slice(5)===T.slice(5)).forEach(b=>L.push('🎂 '+b.n));
const ml=(ag.ml||{})[T];if(ml&&(ml.m||ml.s))L.push('🍽️ Midi : '+(ml.m||'—')+' · Soir : '+(ml.s||'—'));
return L.length?L.join('\n'):'Rien de prévu aujourd’hui.'}
async function docsFor(w){const s=await db.collection('tokens').get(),out=[];s.forEach(d=>{const v=d.data();if(v.w===w)out.push({uid:d.id,tokens:(v.tokens||[]).map(t=>({t,ref:d.ref}))})});return out}
async function privData(uid){try{const d=await db.doc('private/'+uid).get(),v=d.exists?d.data():{};return{ev:v.ev||[],tk:v.tk||[]}}catch(e){console.error('données privées',uid,e.message);return{ev:[],tk:[]}}}
const privEv=async uid=>(await privData(uid)).ev;
async function tokensFor(w){const s=await db.collection('tokens').get(),out=[];s.forEach(d=>{const v=d.data();if(v.w===w)(v.tokens||[]).forEach(t=>out.push({t,ref:d.ref}))});return out}
async function push(list,data,label){if(!list.length){console.log('push: aucun appareil pour',label,'|',data.title);return{n:0,ok:0}}
const res=await getMessaging().sendEachForMulticast({tokens:list.map(x=>x.t),data,webpush:{headers:{Urgency:'high',TTL:'3600'}}});
const err=res.responses.map(r=>r.success?'':((r.error&&r.error.code)||'erreur')).filter(Boolean),info={t:new Date().toISOString(),pour:label,titre:data.title,appareils:list.length,ok:res.successCount,echecs:res.failureCount,erreurs:err};
console.log('push',JSON.stringify(info));
try{const ref=db.doc('notif/last'),d=await ref.get();await ref.set({l:[...((d.exists&&d.data().l)||[]),info].slice(-20)})}catch(e){console.error('journal',e.message)}
for(let i=0;i<res.responses.length;i++){const r=res.responses[i];if(!r.success&&/not-registered|invalid-registration/.test((r.error&&r.error.code)||''))await list[i].ref.update({tokens:FieldValue.arrayRemove(list[i].t)})}
return{n:list.length,ok:res.successCount}}
const endOf=e=>e.e&&e.e>=e.d?e.e:e.d;
const hexId=id=>Buffer.from('tiki'+id).toString('hex');
const addMin=(d,t,m)=>{const[h,mi]=t.split(':').map(Number);let tot=h*60+mi+m;const days=Math.floor(tot/1440);tot=((tot%1440)+1440)%1440;return{date:add(d,days),time:String(Math.floor(tot/60)).padStart(2,'0')+':'+String(tot%60).padStart(2,'0')}};
function gBody(e){const who=NAMES[e.w]||'Commun',b={summary:e.t+' ('+who+')',description:'Ajouté depuis Tiki’s App · pour : '+who,colorId:{g:'9',p:'4',c:'2'}[e.w]||'1',status:'confirmed',reminders:{useDefault:true},extendedProperties:{private:{tiki:'1'}}};
if(!e.s){b.start={date:e.d};b.end={date:add(endOf(e),1)}}else{const st=e.d+'T'+e.s+':00';let en;if(e.f){en=endOf(e)+'T'+e.f+':00';if(en<=st){const x=addMin(e.d,e.s,60);en=x.date+'T'+x.time+':00'}}else{const x=addMin(e.d,e.s,60);en=x.date+'T'+x.time+':00'}b.start={dateTime:st,timeZone:TZ};b.end={dateTime:en,timeZone:TZ}}return b}
async function gToken(){const H={'Metadata-Flavor':'Google'},B='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
const[tk,em]=await Promise.all([fetch(B+'token',{headers:H}).then(r=>r.json()),fetch(B+'email',{headers:H}).then(r=>r.text())]);
const r=await fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+em+':generateAccessToken',{method:'POST',headers:{Authorization:'Bearer '+tk.access_token,'Content-Type':'application/json'},body:JSON.stringify({scope:['https://www.googleapis.com/auth/calendar'],lifetime:'600s'})});
if(!r.ok)throw new Error('Jeton Google refusé ('+r.status+') : '+await r.text());return{token:(await r.json()).accessToken,email:em}}
function gBodyTk(t,T){const who=NAMES[t.w]||'Commun',rec={w:'WEEKLY',m:'MONTHLY',y:'YEARLY'}[t.r],late=!rec&&t.d<T,d=late?T:t.d;
const b={summary:'✅ '+t.t+' ('+who+')',description:'Rappel ajouté depuis Tiki’s App · pour : '+who+(late?' · en retard depuis le '+t.d:''),colorId:'5',status:'confirmed',transparency:'transparent',reminders:{useDefault:true},extendedProperties:{private:{tiki:'1',tikiKind:'rappel'}},start:{date:d},end:{date:add(d,1)}};
if(rec)b.recurrence=['RRULE:FREQ='+rec];return b}
const leap=y=>y%4===0&&(y%100!==0||y%400===0);
function gBodyBd(b,T){const y=+T.slice(0,4);let md=b.d.slice(5);if(md==='02-29'&&!leap(y))md='02-28';const d=y+'-'+md,by=+b.d.slice(0,4);
return{summary:'🎂 Anniversaire de '+b.n,description:'Anniversaire ajouté depuis Tiki’s App · liste : '+(NAMES[b.w]||'Commun')+(by>1900?' · né(e) en '+by:''),colorId:'6',status:'confirmed',transparency:'transparent',reminders:{useDefault:true},extendedProperties:{private:{tiki:'1',tikiKind:'anniversaire'}},start:{date:d},end:{date:add(d,1)},recurrence:['RRULE:FREQ=YEARLY']}}
async function syncGcal(ag){const cal=CAL.value();if(!cal)return;
const T=paris(now()).date,stRef=db.doc('notif/gcal'),st=await stRef.get(),m=(st.exists&&st.data().m)||{},evs=ag.ev||[],tks=(ag.tk||[]).filter(t=>t.id&&t.t&&t.d&&!t.x),bds=(ag.bd||[]).filter(b=>b.id&&b.n&&b.d),all=new Set([...evs.map(e=>e.id),...tks.map(t=>'tk:'+t.id),...bds.map(b=>'bd:'+b.id)]),cut=add(T,-30),todo=[],del=Object.keys(m).filter(id=>!all.has(id));
const hash=b=>crypto.createHash('md5').update(JSON.stringify(b)).digest('hex');
for(const e of evs){if(!e.d||!e.t)continue;if(endOf(e)<cut&&!m[e.id])continue;const b=gBody(e),h=hash(b);if(m[e.id]!==h)todo.push([e.id,b,h])}
for(const t of tks){const k='tk:'+t.id,b=gBodyTk(t,T),h=hash(b);if(m[k]!==h)todo.push([k,b,h])}
for(const x of bds){const k='bd:'+x.id,b=gBodyBd(x,T),h=hash(b);if(m[k]!==h)todo.push([k,b,h])}
if(!todo.length&&!del.length)return;
const{token}=await gToken(),base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(cal)+'/events',H={Authorization:'Bearer '+token,'Content-Type':'application/json'},nm={...m};let n=0;
for(const id of del){const r=await fetch(base+'/'+hexId(id),{method:'DELETE',headers:H});if(r.ok||r.status===404||r.status===410)delete nm[id];else console.error('gcal suppression',id,r.status)}
for(const[id,b0,h]of todo){if(n++>=40)break;const gid=hexId(id),body={...b0,id:gid};let r=await fetch(base+'/'+gid,{method:'PUT',headers:H,body:JSON.stringify(body)});if(!r.ok)r=await fetch(base,{method:'POST',headers:H,body:JSON.stringify(body)});if(r.status===409)r=await fetch(base+'/'+gid,{method:'PATCH',headers:H,body:JSON.stringify(body)});if(r.ok)nm[id]=h;else console.error('gcal envoi',id,r.status,await r.text())}
await stRef.set({m:nm})}

exports.dailySummary=onSchedule({schedule:'0 7 * * *',timeZone:TZ,region:REGION},async()=>{
const T=paris(now()).date,snap=await db.doc('app/agenda').get(),ag=snap.exists?snap.data():{};
for(const w of['g','p']){const docs=await docsFor(w);if(!docs.length){console.log('push: aucun appareil pour',w);continue}
for(const d of docs){const pd=await privData(d.uid),ag2={...ag,ev:(ag.ev||[]).concat(pd.ev),tk:(ag.tk||[]).concat(pd.tk)};await push(d.tokens,{title:'Bonjour '+NAMES[w]+' — aujourd’hui',body:buildSummary(w,ag2,T),tag:'resume-'+T},w)}}});
exports.eventReminders=onSchedule({schedule:'every 5 minutes',timeZone:TZ,region:REGION,timeoutSeconds:300},async()=>{
const p=paris(now()),T=p.date,nowMin=dayNum(T)*1440+p.h*60+p.m,snap=await db.doc('app/agenda').get();if(!snap.exists)return
const ag=snap.data(),stRef=db.doc('notif/state'),st=await stRef.get(),sent=new Set((st.exists&&st.data().sent)||[]),fresh=[];
const due={g:[],p:[]};
for(const e of(ag.ev||[])){if(!e.s||!e.d||(e.d!==T&&e.d!==add(T,1)))continue;const[hh,mm]=e.s.split(':').map(Number),diff=dayNum(e.d)*1440+hh*60+mm-nowMin,key=e.id+'|'+e.d;
if(diff<=0||diff>60||sent.has(key))continue;
const who=e.w==='c'?['g','p']:[e.w];for(const w of who){const k2=key+'|'+w;if(due[w]&&!sent.has(k2))due[w].push({e,diff,k2})}}
for(const w of['g','p']){const L0=due[w].sort((a,b)=>a.diff-b.diff),docs=await docsFor(w);let anyOk=!docs.length;
for(const d of docs){const pv=[];for(const e of await privEv(d.uid)){if(!e.s||!e.d||(e.d!==T&&e.d!==add(T,1)))continue;const[hh,mm]=e.s.split(':').map(Number),diff=dayNum(e.d)*1440+hh*60+mm-nowMin,k2='pv|'+d.uid+'|'+e.id+'|'+e.d;if(diff<=0||diff>60||sent.has(k2))continue;pv.push({e,diff,k2})}
const L=[...L0,...pv].sort((a,b)=>a.diff-b.diff);if(!L.length)continue;
const one=L.length===1,m=L[0],title=one?m.e.s+' · '+m.e.t:L.length+' événements dans environ 1 h',body=one?(m.diff>=45?'Dans environ 1 h':'Dans '+m.diff+' min')+(m.e.w==='c'?' · Commun':''):L.map(x=>x.e.s+' '+x.e.t+(x.e.w==='c'?' · Commun':'')).join('\n');
const r=await push(d.tokens,{title,body,tag:'evt-'+L.map(x=>x.k2).join(',').slice(0,120)},w);
if(r.n===0||r.ok>0){pv.forEach(x=>fresh.push(x.k2));anyOk=true}else console.log('rappel non livré, nouvel essai au prochain passage pour',w)}
if(L0.length&&anyOk)L0.forEach(x=>fresh.push(x.k2))}
if(fresh.length)await stRef.set({sent:[...sent,...fresh].slice(-300)});
try{await syncGcal(ag)}catch(err){console.error('Google Agenda :',err.message)}});
if(process.env.FAKE_NOW)exports._t={buildSummary,nextTk,paris,ferie,gBody,gBodyTk,gBodyBd,hexId,syncGcal};
