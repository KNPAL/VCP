'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="login"><section className="loginpanel" role="alert"><h1>Connection unavailable</h1><p>The workspace could not verify your session.</p><button className="primary" onClick={reset}>Retry</button></section></main>}
