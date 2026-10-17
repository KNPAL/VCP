'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="panel" role="alert"><h1>Workspace unavailable</h1><p>Your data could not be loaded. Please retry.</p><button className="primary" onClick={reset}>Try again</button></section>}
