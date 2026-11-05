import DownloadJobs from '../../../../../../components/download-jobs';
import StoredCandles from '../../../../../../components/download-chart';
export default async function Page({params,searchParams}:{params:Promise<{runId:string}>;searchParams:Promise<{listing?:string}>}){
 const {runId}=await params,{listing}=await searchParams;
 return listing?<StoredCandles runId={runId} listing={listing}/>:<DownloadJobs runId={runId}/>;
}
