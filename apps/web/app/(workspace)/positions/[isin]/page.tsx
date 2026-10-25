import {notFound} from 'next/navigation';
import PositionDetail from '../../../../components/position-detail';
export default async function Detail({params}:{params:Promise<{isin:string}>}){const {isin}=await params;if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin))notFound();return <PositionDetail isin={isin}/>}
