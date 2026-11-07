'use client';
import {useEffect,useState} from 'react';
import BrokerConnection from './broker-connection';
import {brokerChanged} from './broker-health';
type Network={clientLocalIp:string;clientPublicIp:string;macAddress:string;ipProof:{address:string;verifiedAt:string;expiresAt:string;sourceReference:string}};
type Setup={revision:string;network:Network|null;source:string;runtime:{transportAllowed:boolean;configurationKeyReady:boolean;sessionKeyReady:boolean;liveEnabled:boolean};suggestedNetwork:{clientLocalIp:string;macAddress:string}};
const localTime=(value:string)=>{const d=new Date(value);return Number.isFinite(d.valueOf())?new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):''};
const failures:Record<string,string>={INVALID_BROKER_NETWORK:'Check both IP addresses, the MAC address and verification dates. Verification must be in the past and expiry must be in the future.',BROKER_NETWORK_CONFLICT:'These settings changed in another tab. Reload configuration before saving.',BROKER_HTTPS_REQUIRED:'Use HTTPS on a server, or start the local app with the documented local launcher.', 'Invalid request origin':'The browser address does not match the application origin. Use the address shown by the launcher.'};
export default function ConfigurationWorkspace(){
 const [setup,setSetup]=useState<Setup|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/v1/configuration',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error(r.status===401?'Sign in again to configure the application.':'Configuration could not be loaded.');setSetup(await r.json())}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[version]);
 async function save(form:HTMLFormElement){
  if(!setup||busy)return;setBusy(true);setError('');setNotice('');
  try{
   const fields=new FormData(form),value=(name:string)=>String(fields.get(name)??'').trim();
   const network:Network={clientLocalIp:value('clientLocalIp'),clientPublicIp:value('clientPublicIp'),macAddress:value('macAddress'),ipProof:{address:value('clientPublicIp'),verifiedAt:new Date(value('verifiedAt')).toISOString(),expiresAt:new Date(value('expiresAt')).toISOString(),sourceReference:value('sourceReference')}};
   const session=await fetch('/api/v1/auth/session',{cache:'no-store'});if(!session.ok)throw new Error('Sign in again to save configuration.');
   const r=await fetch('/api/v1/configuration/network',{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':(await session.json()).csrfToken,'if-match':setup.revision},body:JSON.stringify(network)}),body=await r.json();
   if(!r.ok)throw new Error(failures[body.error?.message]??'Unable to save configuration. Reload and check your session.');
   setSetup({...setup,...body,source:'DATABASE'});setNotice('Network settings saved. Reconnect Angel One below to use these settings.');brokerChanged();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save configuration.')}finally{setBusy(false)}
 }
 return <div className="configuration-workspace"><div className="pagehead"><div><div className="eyebrow">Application setup</div><h1>Configuration</h1><p>Set up your server network and Angel One connection in one place.</p></div><button className="quiet" disabled={busy} onClick={()=>{setError('');setVersion(v=>v+1)}}>Reload configuration</button></div>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {!setup?<p role="status">Loading configuration…</p>:<>
 <section className="panel"><h2>Startup checks</h2><dl className="configuration-checks"><dt>Secure connection or local development</dt><dd>{setup.runtime.transportAllowed?'Ready':'Action required — use HTTPS or the local launcher'}</dd><dt>Broker configuration encryption</dt><dd>{setup.runtime.configurationKeyReady?'Ready':'Action required — run node scripts/init-local.mjs, then restart the API'}</dd><dt>Broker session encryption</dt><dd>{setup.runtime.sessionKeyReady?'Ready':'Action required — initialize server keys and restart the API/worker'}</dd><dt>Live streaming</dt><dd>{setup.runtime.liveEnabled?'Enabled; data readiness still applies':'Disabled in server startup settings'}</dd></dl><p className="caption">Encryption keys stay on the server. They are never entered in this form. For a hosted deployment, your operator must mount the existing keys.</p></section>
 <section className="panel"><h2>Broker network settings</h2><p>Use the public outbound IP of the server running this application. Confirm it with your ISP/cloud provider and SmartAPI app settings. Saving these settings does not verify them with Angel One or approve data licensing.</p>
 <form key={setup.revision+'-'+version} onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><fieldset disabled={busy||!setup.runtime.transportAllowed}><legend>Network identity and verification</legend><div className="configuration-fields">
 <label className="field">Server public IPv4<input name="clientPublicIp" required defaultValue={setup.network?.clientPublicIp??''} placeholder="Your verified outbound public IP"/></label>
 <label className="field">Server local IP<input name="clientLocalIp" required defaultValue={setup.network?.clientLocalIp??setup.suggestedNetwork.clientLocalIp}/></label>
 <label className="field">Server MAC address<input name="macAddress" required defaultValue={setup.network?.macAddress??setup.suggestedNetwork.macAddress}/></label>
 <label className="field">Verification reference<input name="sourceReference" required maxLength={500} defaultValue={setup.network?.ipProof.sourceReference??''} placeholder="ISP/cloud confirmation and SmartAPI registration reference"/></label>
 <label className="field">Verified at (your local time)<input name="verifiedAt" type="datetime-local" required defaultValue={localTime(setup.network?.ipProof.verifiedAt??'')}/></label>
 <label className="field">Verification expires (your local time)<input name="expiresAt" type="datetime-local" required defaultValue={localTime(setup.network?.ipProof.expiresAt??'')}/></label>
 </div><label className="configuration-confirm"><input type="checkbox" required/> I have checked these network values and the verification reference.</label><p className="caption">Changing network settings disconnects the previous broker session and pauses its downloads. Dates are stored in UTC. Existing settings: {setup.source==='DATABASE'?'saved in this application':setup.source==='SERVER_FILE'?'provided by the server':'not configured'}.</p><button className="primary" type="submit">{busy?'Saving network settings…':'Save network settings'}</button></fieldset></form></section>
 </>}
 <BrokerConnection embedded/>
 </div>;
}
