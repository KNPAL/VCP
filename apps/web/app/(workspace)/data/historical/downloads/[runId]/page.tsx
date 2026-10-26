import DownloadJobs from '../../../../../../components/download-jobs';
export default async function Page({params}:{params:Promise<{runId:string}>}){const {runId}=await params;return <DownloadJobs runId={runId}/>}
