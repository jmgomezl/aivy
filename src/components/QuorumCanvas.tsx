import {useEffect, useRef, useState} from 'react'
import './QuorumCanvas.css'

type Rules = {requestId:string; placeId:string; monthlyBudget:number; minimumPayout:number; acceptTerms:boolean}
type Policy = {serial:string; premium:number; payout:number; beneficiaryId:string; lapsesAt:string; saleTxId:string; scheduleId:string; termsPointer:string}
type Mandate = {id:string; place:{name:string;lat:number;lon:number}; rules:Rules; status:string; enabled:boolean; accountId:string; createdAt:string; expiresAt:string; nextDueAt:string|null; maxPurchases:number; maxTotalPremium:number; message:string|null; attempts:{cycle:number;requestId:string;status:string;policy:Policy|null}[]}
type View = {mandate:Mandate|null; scheduler:{intervalSeconds:number;lastCheckedAt:string|null}}
type Preview = {ok:boolean; message?:string; days:number; nextDueAt:string; quote:{ok:boolean; settled?:{premium:number;payout:number}}}
const SESSION='aivy-quorum-session-v1', DRAFT='aivy-quorum-draft-v1'
const places=[['medellin','Medellín'],['mexico','Mexico City'],['tokyo','Tokyo']]
const number=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2})
const date=(s:string|null)=>s?new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
const receiptUrl=(id:string)=>`https://hashscan.io/testnet/transaction/${encodeURIComponent(id)}`

function savedRules():Rules{
 try{const d=JSON.parse(localStorage.getItem(DRAFT)||'null');if(d?.requestId&&places.some(p=>p[0]===d.placeId))return {...d,acceptTerms:false}}catch{/* Keep an invalid draft from authorizing anything. */}
 return {requestId:crypto.randomUUID(),placeId:'medellin',monthlyBudget:10,minimumPayout:800,acceptTerms:false}
}
function ensureSession(){
 if(!localStorage.getItem(SESSION))localStorage.setItem(SESSION,Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''))
}
async function api<T>(path:string,body?:object):Promise<T>{
 const token=localStorage.getItem(SESSION)
 const r=await fetch(`/api/quorum${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})})
 const text=await r.text();let data
 try{data=JSON.parse(text)}catch{throw new Error('The cover-agent service is unavailable. Your saved request is retained.')}
 if(!r.ok)throw Object.assign(new Error(data.message||'The request could not complete.'),{status:r.status})
 return data as T
}

export default function QuorumCanvas(){
 const [rules,setRules]=useState<Rules>(savedRules),[preview,setPreview]=useState<Preview|null>(null),[view,setView]=useState<View|null>(null)
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[statusError,setStatusError]=useState(''),[notice,setNotice]=useState(''),[available,setAvailable]=useState(false),[accepted,setAccepted]=useState(false)
 const alive=useRef(true),mandate=view?.mandate,policy=mandate?.attempts.filter(a=>a.policy).at(-1)?.policy,done=Boolean(policy),running=mandate?.status==='running'
 const effective=mandate?.rules||rules,place=mandate?.place.name||places.find(p=>p[0]===rules.placeId)?.[1]||'Medellín'
 async function refresh(){
  if(!localStorage.getItem(SESSION))return
  try{const data=await api<View>('/');if(alive.current){setView(data);setStatusError('')}}catch(e){if((e as {status?:number}).status!==401&&alive.current)setStatusError(e instanceof Error?e.message:'Status unavailable.')}
 }
 useEffect(()=>{
  alive.current=true;document.title='Cover agent · Aivy × Quorum'
  api<{ok:boolean;network:string}>('/info').then(d=>{if(alive.current)setAvailable(d.ok&&d.network==='testnet')}).catch(()=>{if(alive.current)setError('The testnet agent service is unavailable. Try refreshing shortly.')})
  void refresh();return()=>{alive.current=false}
 },[])
 useEffect(()=>{const t=setInterval(()=>void refresh(),running?2500:15000);return()=>clearInterval(t)},[running])
 function change(patch:Partial<Rules>){setRules(old=>{const next={...old,...patch};localStorage.setItem(DRAFT,JSON.stringify(next));return next});setPreview(null);setAccepted(false);setError('')}
 async function review(){setBusy('Checking the quote…');setError('');try{setPreview(await api<Preview>('/quote',{...rules,acceptTerms:true}))}catch(e){setError((e as Error).message)}finally{setBusy('')}}
 async function activate(){
  if(!accepted||!preview?.ok)return
  setError('');setNotice('');setBusy('Preparing your funded testnet account…');ensureSession();localStorage.setItem(DRAFT,JSON.stringify(rules))
  try{await api('/start',{});setBusy('Saving your monthly rules…');const next=await api<View>('/activate',{...rules,acceptTerms:true});setView(next);setStatusError('');setNotice('Rules saved. Every purchase must pass the same limits.')}
  catch(e){setError((e as Error).message);await refresh()}finally{setBusy('')}
 }
 async function action(name:'pause'|'resume'|'run'){
  setError('');setNotice('');setBusy(name==='pause'?'Pausing new purchases…':'Checking your saved mandate…')
  try{const next=await api<View>(`/${name}`,{});setView(next);setStatusError('');setNotice(name==='pause'?'New purchases paused. Existing cover and any already accepted purchase remain.':name==='run'&&next.mandate?.status!=='running'?'No extra policy purchased. The agent waits until the next eligible renewal.':'Saved rules are active.')}
  catch(e){setError((e as Error).message)}finally{setBusy('')}
 }
 const status=({scheduled:'Scheduled',running:'Purchasing',paused:'Paused',needs_attention:'Needs attention',needs_review:'Needs review',completed:'Plan complete',expired:'Plan ended'} as Record<string,string>)[mandate?.status||'']||'Ready to configure'
 return <div className="quorum-canvas">
  <header className="qc-header"><a className="qc-brand" href="/"><img src="/logo-192.png" alt=""/>Aivy <span>×</span> <strong>Quorum</strong></a><nav aria-label="Project links"><a href="/">Agent office ↗</a><a href="https://quorum.aivylabs.xyz" target="_blank" rel="noreferrer">Explore Quorum ↗</a></nav></header>
  <main className="qc-main">
   <div className="qc-intro"><div><p className="qc-eyebrow">COVER AGENT · TESTNET</p><h1>Your place.<br/><span>Your rules. Every month.</span></h1></div><p>Set a budget. Quorum checks the terms.<br/>Every purchase leaves a receipt.</p></div>
   <div className="qc-board" aria-label="Monthly cover workflow">
    <div className="qc-board-top"><span>01 — MONTHLY COVER CANVAS</span><span className={`qc-status ${mandate?.enabled?'is-active':''}`}><i/>{status}</span></div>
    <div className="qc-nodes">
     <article className={`qc-node ${mandate?'is-done':''}`}><div className="qc-node-top"><span>01</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 2v6m8-6v6M4 11h16m-11 4h2m3 0h2"/></svg></div><h2>Every month</h2><p>{mandate?`Next: ${date(mandate.nextDueAt)}`:'First purchase on activation'}</p><span className="qc-node-tag">3 monthly periods</span></article>
     <article className={`qc-node ${mandate?'is-done':''}`}><div className="qc-node-top"><span>02</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg></div><h2>≤ {effective.monthlyBudget} <small>aUSDd</small></h2><p>At least {number(effective.minimumPayout)} aUSDd payout</p><span className="qc-node-tag">Pause if rules fail</span></article>
     <article className={`qc-node ${running?'is-running':done?'is-done':''}`}><div className="qc-node-top"><span>03</span><span className="qc-quorum-symbol">◉</span></div><h2>Aivy Quorum</h2><p>{running?'Checking & committing cover…':'Price → verify rules → issue'}</p><span className="qc-node-tag">Guarded Hedera purchase</span></article>
     <article className={`qc-node qc-receipt-node ${done?'is-done':''}`}><div className="qc-node-top"><span>04</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/></svg></div><h2>{policy?`Cover #${policy.serial}`:'Your policy NFT'}</h2><p>{policy?`${number(policy.payout)} aUSDd conditional payout`:place}</p>{policy?<a className="qc-node-tag" href={`https://quorum.aivylabs.xyz/policy/${policy.serial}`} target="_blank" rel="noreferrer">Open actual policy ↗</a>:<span className="qc-node-tag">Appears after confirmation</span>}</article>
    </div>
   </div>
   {!mandate?<section className="qc-config" aria-labelledby="qc-instruction">
    <div className="qc-instruction"><p className="qc-eyebrow" id="qc-instruction">02 — YOUR INSTRUCTION</p><fieldset disabled={Boolean(busy)}><legend className="qc-sr">Monthly cover rules</legend><div className="qc-sentence">Buy cover in <select aria-label="Protected city" value={rules.placeId} onChange={e=>change({placeId:e.target.value})}>{places.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><br/>every month, using <label><input aria-label="Monthly premium budget" type="number" min="1" max="10" step="0.5" value={rules.monthlyBudget} onChange={e=>change({monthlyBudget:Number(e.target.value)})}/><span>aUSDd.</span></label></div><div className="qc-minimum"><label htmlFor="qc-minimum">Minimum payout</label><div><input id="qc-minimum" type="number" min="1" max="2000" step="50" value={rules.minimumPayout} onChange={e=>change({minimumPayout:Number(e.target.value)})}/><span>aUSDd</span></div></div></fieldset><p className="qc-small">The budget is fixed. The payout can change. Below your minimum, the agent pauses.</p></div>
    <div className="qc-review"><p className="qc-eyebrow">REVIEW BEFORE ACTIVATING</p>{preview?.ok&&preview.quote.settled?<><div className="qc-quote"><div><span>First premium</span><strong>{number(preview.quote.settled.premium)}</strong></div><span aria-hidden="true">→</span><div><span>Conditional payout</span><strong>{number(preview.quote.settled.payout)}</strong></div></div><p className="qc-small">aUSDd · {preview.days} days · next attempt {date(preview.nextDueAt)}</p><label className="qc-consent"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={Boolean(busy)}/><span>Allow 3 monthly testnet purchases. Maximum {number(rules.monthlyBudget*3)} aUSDd in premiums. Pause anytime.</span></label><button className="qc-primary" disabled={!accepted||Boolean(busy)||!available} onClick={()=>void activate()}>{busy||'Activate & buy first cover →'}</button></>:<><p className="qc-review-intro">One place. A monthly limit.<br/>A receipt for every purchase.</p>{preview&&!preview.ok&&<p className="qc-warning">{preview.message}</p>}<button className="qc-primary" disabled={Boolean(busy)||!available} onClick={()=>void review()}>{busy||'Review my plan →'}</button></>}<p className="qc-demo-note"><i/>Funded testnet account · no wallet extension · no cash value</p></div>
   </section>:<section className="qc-live" aria-label="Saved agent and receipts">
    <div className="qc-live-summary"><p className="qc-eyebrow">YOUR SAVED COVER AGENT</p><h2>{place}</h2><div className="qc-live-metrics"><div><span>Premiums spent</span><strong>{number(mandate.attempts.reduce((n,a)=>n+(a.policy?.premium||0),0))}<small> / {number(mandate.maxTotalPremium)} aUSDd</small></strong></div><div><span>Policies confirmed</span><strong>{mandate.attempts.filter(a=>a.status==='complete').length}<small> / 3</small></strong></div><div><span>{mandate.enabled?'Next attempt':'Saved next date'}</span><strong className="qc-date">{date(mandate.nextDueAt)}</strong></div></div><div className="qc-actions"><button className={mandate.enabled?'qc-secondary':'qc-primary'} disabled={Boolean(busy)||['needs_review','expired','completed'].includes(mandate.status)} onClick={()=>void action(mandate.enabled?'pause':'resume')}>{busy||(mandate.enabled?'Pause agent':'Resume agent →')}</button><button className="qc-text-button" disabled={Boolean(busy)||running} onClick={()=>void refresh()}>Refresh status ↻</button>{mandate.enabled&&<button className="qc-text-button" disabled={Boolean(busy)||running} onClick={()=>void action('run')}>Check renewal now</button>}</div>{mandate.message&&<p className="qc-warning">{mandate.message}</p>}</div>
    <div className="qc-evidence"><p className="qc-eyebrow">REAL HEDERA TESTNET RECEIPTS</p>{policy?<><a className="qc-policy-link" href={`https://quorum.aivylabs.xyz/policy/${policy.serial}`} target="_blank" rel="noreferrer"><span>Policy #{policy.serial}<small>{number(policy.payout)} aUSDd conditional payout</small></span><span>↗</span></a><div className="qc-proof-links"><a href={receiptUrl(policy.saleTxId)} target="_blank" rel="noreferrer">Premium transfer ↗</a><a href={`https://hashscan.io/testnet/schedule/${policy.scheduleId}`} target="_blank" rel="noreferrer">Scheduled payout ↗</a></div><p className="qc-small">Cover ends {date(policy.lapsesAt)}. This is an issued policy, not a simulated transaction.</p></>:<div className="qc-wait"><span className={running?'qc-pulse':''}>◉</span><p>{running?'Waiting for ledger confirmation.':'No policy has been confirmed yet.'}</p><small>Keep this page open or return later. The saved request will not be replaced.</small></div>}</div>
   </section>}
   <div className="qc-feedback" aria-live="polite">{(error||(!busy&&statusError))&&<p className="qc-warning" role="alert">{error||statusError} <button className="qc-text-button" onClick={()=>void refresh()}>Check saved status</button></p>}{notice&&!running&&<p>{notice}</p>}</div>
   <div className="qc-terms"><div><span>M6+</span><span>Within 100 km</span><span>Depth ≤70 km</span><span>Test tokens only</span></div><p>Payment requires the recorded earthquake conditions. Damage alone does not trigger a payout.</p></div>
   <details className="qc-details"><summary>What this agent can do <span>+</span></summary><div><p>This is a dedicated Aivy cover canvas, executed by Quorum’s deterministic testnet scheduler. It does not use the office’s general AI tools, AivyVault, or KMS custody. Your approved rules are stored on the server; a worker checks them every 30 seconds, even when this page is closed.</p><p>One purchase per eligible monthly period, for up to three periods. Premiums use your funded, service-managed aUSDd account. Network fees are sponsored and still subject to Quorum’s global limits. The service assigns a separate managed beneficiary for each non-transferable policy NFT.</p><p>No backdated purchases or guaranteed uninterrupted cover: insufficient funds, unavailable data, pool limits or an outage can pause a renewal. An uncertain transaction stops for review. An already accepted purchase may finish after you pause. Earthquake checks remain request-driven.</p><p>Browser storage controls access to this demo account. Clearing it loses access; the mandate can continue until it expires. Pause before clearing storage. No real cash, commercial insurance, or unlimited authority is granted.</p>{mandate&&<p>Funding account <a href={`https://hashscan.io/testnet/account/${mandate.accountId}`} target="_blank" rel="noreferrer">{mandate.accountId} ↗</a> · mandate ends {date(mandate.expiresAt)}.</p>}<a href="https://github.com/jmgomezl/aivy-parametric-pool/blob/main/docs/COVER-AGENT.md" target="_blank" rel="noreferrer">Architecture & guardrails ↗</a></div></details>
  </main><footer className="qc-footer"><span>Aivy sets the rules. Quorum makes the commitment verifiable.</span><a href="https://quorum.aivylabs.xyz/demo-video/" target="_blank" rel="noreferrer">Watch the demo ↗</a></footer>
 </div>
}
