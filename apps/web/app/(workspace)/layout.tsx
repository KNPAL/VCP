import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import type {ReactNode} from 'react';
import {Navigation,Logout} from '../components/navigation';
import LiveUpdates from '../../components/live-updates';
export default async function Workspace({children}:{children:ReactNode}){
 const token=(await cookies()).get('vcp_session')?.value;
 if(!token)redirect('/login');
 const response=await fetch((process.env['API_INTERNAL_URL']??'http://127.0.0.1:3001')+'/api/v1/auth/session',{headers:{Cookie:'vcp_session='+token},cache:'no-store'});
 if(response.status===401||response.status===403)redirect('/login');
 if(!response.ok)throw new Error('Session service unavailable');
 const {owner}=await response.json();
 return <div className="shell"><a className="skip" href="#main">Skip to content</a><aside className="sidebar"><div className="brand"><span className="mark">↗</span><span>Study Trade<small>VCP WORKSPACE</small></span></div><div className="navgroup">YOUR WORKSPACE</div><Navigation/><div className="sidefoot">ST_VCP_4_0<br/>Research. Plan. Record.<br/>Manual execution only.</div></aside><div><header className="topbar"><span className="mobilebrand">Study Trade</span><span className="pill">○ Market data unverified</span><div className="topright"><LiveUpdates/><span>{owner.login}</span><Logout/></div></header><main id="main" className="content">{children}</main></div></div>;
}

