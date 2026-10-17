import {sma,ema21,atr14,natr,atrCompression,vdu,rvol,range52,trendTemplate,type Series} from './index.js';
export function snapshot(s:Series,rs:string|null=null){return {sma20:sma(s,20),sma50:sma(s,50),sma150:sma(s,150),sma200:sma(s,200),ema21:ema21(s),atr14:atr14(s),natr:natr(s),atrCompression:atrCompression(s),vdu:vdu(s),rvol50:rvol(s,50),rvol20:rvol(s,20),range52:range52(s),trendTemplate:trendTemplate(s,rs)}}
/** Recompute from the original seed after a correction; never carry a stale EMA/ATR. */
export function replay(s:Series,changedFrom:number){
 if(!Number.isSafeInteger(changedFrom)||changedFrom<0||changedFrom>=s.bars.length)throw new Error('INVALID_CORRECTION_INDEX');
 return s.bars.slice(changedFrom).map((bar,offset)=>{const end=changedFrom+offset+1;const prefix={...s,bars:s.bars.slice(0,end),sessions:s.sessions.slice(0,end)};return {session:bar.session,dataRevision:s.dataRevision,evidence:snapshot(prefix)}});
}
