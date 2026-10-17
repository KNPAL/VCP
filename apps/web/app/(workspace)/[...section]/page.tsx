import Link from 'next/link';
import {notFound} from 'next/navigation';
const pages:Record<string,[string,string]> = {
 dashboard:['Market overview','A clear view of your research, signals and portfolio.'],
 universe:['Universe & data','Know the coverage and freshness behind every decision.'],
 screener:['VCP screener','Find confirmed contraction patterns across your verified universe.'],
 inspector:['Chart inspector','Inspect price structure, contraction legs and the evidence behind a setup.'],
 buy:['BUY signals','Review confirmed breakouts separately from your portfolio eligibility.'],
 positions:['My positions','Your actual manual fills are the source of truth.'],
 sell:['SELL alerts','Review protective exits and position management signals.'],
 backtests:['Historical replay','Evaluate the strategy with point-in-time data and explicit assumptions.'],
 settings:['Workspace settings','Manage your connections and immutable strategy profiles.'],
 operations:['Operations','Inspect service health, data readiness and processing status.'],
 'settings/broker/angel-one':['Angel One connection','Manage the verified market-data connection for your workspace.'],
 'data/historical/download':['Historical download','Prepare a historical import after connecting your data provider.'],
 'data/historical/downloads':['Download history','Inspect coverage, missing sessions and previous import runs.']
};
export default async function Screen({params}:{params:Promise<{section:string[]}>}){const {section}=await params;const route=section.join('/');const page=pages[route]??(section.length===4 && section.slice(0,3).join('/')==='data/historical/downloads'?['Download details','Inspect the selected historical import run.']:undefined);if(!page)notFound();
return <><div className="pagehead"><div><div className="eyebrow">Workspace / {route==='dashboard'?'Overview':section[0]}</div><h1>{page[0]}</h1><p>{page[1]}</p></div><span className="pill">Setup required</span></div>{route==='dashboard'&&<div className="cards">{[['Market regime','Unknown','Verified benchmark and breadth required'],['Scan coverage','Unavailable','No finalized universe scan available'],['Open positions','Unverified','Portfolio reconciliation required'],['Eligible signals','Blocked','Required data gates are not verified']].map(([label,value,caption])=><section className="card" key={label}><div className="cardlabel">{label}</div><div className="value">{value}</div><div className="caption">{caption}</div></section>)}</div>}<div className="grid"><section className="panel"><div className="panelhead"><h2>{route==='dashboard'?'Research workspace':page[0]}</h2><span className="caption">Source freshness: unavailable · IST</span></div><div className="empty"><div className="emptyicon" aria-hidden="true">◎</div><h2>{route==='settings'?'Configure your workspace':'Verified data comes first'}</h2><p>This module is being implemented. Live results are unavailable.<br/>Signals stay blocked until the required data is verified.</p><Link className="primary" href="/settings/broker/angel-one">Broker connection →</Link></div></section><section className="panel"><h2>Workspace setup</h2>{[['01','Connect market data','Review your Angel One connection.','/settings/broker/angel-one'],['02','Import price history','Load completed sessions for analysis.','/data/historical/download'],['03','Review data coverage','Check the status of historical imports.','/data/historical/downloads']].map(([n,title,body,href])=><Link key={n} className="step" href={href!}><span className="stepnum">{n}</span><div><strong>{title} →</strong><p>{body}</p></div></Link>)}</section></div><div className="note">Manual signals only. A signal or alert never changes your holdings. Record actual executed fills to update your portfolio.</div></>}

