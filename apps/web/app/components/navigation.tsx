'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export const navigation = [
 ['My watchlists','/watchlists','☆'],['IPO research','/research/ipo','◇'],['SME research','/research/sme','◇'],
 ['Overview','/dashboard','◫'],['Universe & data','/universe','◎'],['VCP screener','/screener','⌕'],['Chart inspector','/inspector','⌁'],['BUY signals','/buy','↗'],['My positions','/positions','▣'],['SELL alerts','/sell','↙'],['Backtests','/backtests','◷'],['Settings','/settings','⚙'],['Operations','/operations','◇'],
] as const;
export function Navigation(){const path=usePathname();return <nav aria-label="Main navigation">{navigation.map(([label,href,icon])=><Link className="navlink" aria-current={path===href?'page':undefined} key={href} href={href}><span className="navicon" aria-hidden="true">{icon}</span>{label}</Link>)}</nav>}
export function Logout(){const [pending,setPending]=useState(false);return <button className="quiet" disabled={pending} onClick={async()=>{setPending(true);try{const s=await fetch('/api/v1/auth/session');if(!s.ok)throw new Error();const body=await s.json();const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'X-CSRF-Token':body.csrfToken}});if(!r.ok)throw new Error();window.location.assign('/login');}catch{setPending(false);window.alert('Unable to sign out. Please retry.');}}}>Sign out</button>}
import {useState} from 'react';


