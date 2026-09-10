import {useEffect,useRef,useState} from 'react'
import './QuorumCompanion.css'

type Answer={message:string;facts:{label:string;value:string;tone:string}[];links:{label:string;url:string}[];control:boolean;source:'ai'|'quick'|'fallback';checkedAt:string;ledgerCheckedAt:string|null}
type Turn={question:string;answer?:Answer;error?:string}
const prompts=[['Policy status','status'],['Next renewal','renewal'],['My budget','budget']]
export default function QuorumCompanion({policySerial,onOpenChange}:{policySerial?:string;onOpenChange:(open:boolean)=>void}){
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[turns,setTurns]=useState<Turn[]>([]),[busy,setBusy]=useState(false)
 const root=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),log=useRef<HTMLDivElement>(null),launcher=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),pending=useRef(false)
 function toggle(next:boolean,restoreFocus=true){setOpen(next);onOpenChange(next);if(!next&&restoreFocus)launcher.current?.focus({preventScroll:true})}
 useEffect(()=>{
  if(!open)return
  if(matchMedia('(min-width:761px)').matches)input.current?.focus({preventScroll:true});else closeButton.current?.focus({preventScroll:true})
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')toggle(false)}
  const outside=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))toggle(false,false)}
  document.addEventListener('keydown',escape);document.addEventListener('click',outside)
  return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('click',outside)}
 },[open])
 useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight},[turns,busy,open])
 async function ask(text:string,topic?:string){
  if(pending.current||!text.trim())return
  pending.current=true;setBusy(true);setQuestion('');setTurns(old=>[...old.slice(-9),{question:text.trim()}])
  try{
   const token=localStorage.getItem('aivy-quorum-session-v1')
   const response=await fetch('/api/quorum/chat',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({question:text.trim(),...(topic?{topic}:{})}),signal:AbortSignal.timeout(20000)})
   const data=await response.json().catch(()=>null);if(!response.ok)throw Error(data?.message||'I could not read your status. Please try again.')
   if(data?.mode!=='read_only'||typeof data.message!=='string'||!Array.isArray(data.facts)||!Array.isArray(data.links))throw Error('The companion response could not be read.')
   setTurns(old=>old.map((t,i)=>i===old.length-1?{...t,answer:data}:t))
  }catch(e){setTurns(old=>old.map((t,i)=>i===old.length-1?{...t,error:e instanceof Error&&e.name!=='TimeoutError'?e.message:'The status check timed out. Your policy has not been changed.'}:t))}
  finally{pending.current=false;setBusy(false)}
 }
 function showControls(){toggle(false);requestAnimationFrame(()=>document.querySelector('.qc-actions,.qc-config')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'center'}))}
 return <div className="qc-companion" ref={root}>
  {open&&<section className="qc-chat-panel" role="dialog" aria-label="Cover companion" aria-modal="false">
   <header className="qc-chat-header"><div className={`qc-bot-stage ${busy?'is-thinking':''}`} aria-hidden="true"><span className="qc-pixel-bot"/><i/></div><div><p>YOUR COVER COMPANION</p><h2>Ask your agent.</h2><span><i/>Read only · Hedera testnet</span></div><button ref={closeButton} className="qc-chat-close" aria-label="Close companion" onClick={()=>toggle(false)}>×</button></header>
   <div className="qc-chat-log" ref={log} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
    <div className="qc-chat-intro"><span className="qc-chat-who">QUORUM</span><p>{policySerial?`Let’s check your cover #${policySerial}. Ask me about its status, next renewal or spending limits.`:'I can help you read your cover. Start with a question, or review a plan on the canvas.'}</p></div>
    {turns.map((turn,i)=><div className="qc-chat-turn" key={i}><p className="qc-chat-question">{turn.question}</p>{turn.answer&&<div className="qc-chat-answer"><span className="qc-chat-who">QUORUM</span><p>{turn.answer.message}</p>{turn.answer.facts.length>0&&<dl>{turn.answer.facts.map(f=><div key={f.label}><dt>{f.label}</dt><dd className={f.tone==='mint'?'is-mint':''}>{f.value}</dd></div>)}</dl>}{turn.answer.links.length>0&&<div className="qc-chat-proof">{turn.answer.links.map(l=><a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>}{turn.answer.control&&<button className="qc-chat-controls" onClick={showControls}>Show canvas controls →</button>}<small className="qc-chat-source">{turn.answer.source==='ai'?'AI interpreted · Quorum data':turn.answer.source==='fallback'?'Direct answer · AI unavailable':'Direct policy read'} · {new Date(turn.answer.ledgerCheckedAt||turn.answer.checkedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</small></div>}{turn.error&&<p className="qc-chat-error" role="alert">{turn.error}</p>}</div>)}
    {busy&&<div className="qc-chat-thinking" role="status"><span><i/><i/><i/></span>Reading your question and policy…</div>}
   </div>
   <div className="qc-chat-bottom"><div className="qc-chat-prompts">{prompts.map(([label,topic])=><button key={topic} disabled={busy} onClick={()=>void ask(label,topic)}>{label}</button>)}</div><form onSubmit={e=>{e.preventDefault();void ask(question)}}><label className="qc-sr" htmlFor="qc-chat-question">Ask your cover companion</label><textarea ref={input} id="qc-chat-question" placeholder="How is my cover doing?" rows={1} maxLength={400} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void ask(question)}}}/><button type="submit" disabled={busy||!question.trim()} aria-label="Send question">↑</button></form><details className="qc-chat-about"><summary>How answers work <span>↗</span></summary><p>AI interprets typed questions; Quorum supplies policy facts and receipt links. Chat has no signing or purchase tools. Only your question goes to OpenAI, not your account capability or policy data. Quick questions skip AI. Conversation stays in this tab’s memory.</p></details></div>
  </section>}
  <button ref={launcher} className={`qc-companion-launcher ${open?'is-open':''}`} aria-label={open?'Hide cover companion':'Ask your cover companion'} aria-expanded={open} onClick={()=>toggle(!open)}><span className="qc-bot-stage" aria-hidden="true"><span className="qc-pixel-bot"/><i/></span><span><strong>{open?'Your companion':'Ask your agent'}</strong><small>{policySerial?`Cover #${policySerial} · testnet`:'Cover companion · testnet'}</small></span><span className="qc-companion-toggle" aria-hidden="true">{open?'−':'↗'}</span></button>
 </div>
}
