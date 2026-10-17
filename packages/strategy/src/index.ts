import {createHash} from 'node:crypto';
export * from './ranking.js';
export * from './scans.js';
export * from './signals.js';
export * from './candidates.js';
export const PROFILE_VERSION='ST_VCP_4_0_CONFIG_2';
export const ST_VCP_4_0=Object.freeze({
 configurationRevision:2,
 version:'ST_VCP_4_0',algorithm:'ST_VCP_LOCAL_EXTREMA_V1',swingLeft:3,swingRight:3,
 minimumLegs:2,maximumLegs:6,minimumBaseSessions:10,maximumBaseSessions:90,
 minimumDepth:'0.01',maximumFirstDepth:'0.35',maximumFinalDepth:'0.12',contractionRatio:'0.90',
 pretrendReturn:'0.20',readyProximity:'0.04',maximumVdu:'0.80',breakoutRvol:'1.50',
 trendRsExclusive:'70',buyRsInclusive:'80',comparableCoverage:'0.80',minimumMedianTurnover:'200000000',
 baselineRisk:'0.004',hardRisk:'0.005',maximumStop:'0.08',maximumPositions:5,
 stockCap:'0.15',sectorCap:'0.30',openRiskCap:'0.02',greenGrossCap:'0.75',yellowGrossCap:'0.35',
 entrySessions:2,chaseCap:'0.03',quoteFreshnessSeconds:60,heartbeatFreshnessSeconds:30,planValiditySeconds:30,partialProfitEnabled:true,
 automaticOrders:false,automaticAddSignal:false,
});
export function canonicalConfiguration(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonicalConfiguration).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalConfiguration(v)).join(',')+'}';
 if(value===undefined||typeof value==='function'||typeof value==='bigint'||(typeof value==='number'&&!Number.isFinite(value)))throw new Error('INVALID_CONFIGURATION');
 return JSON.stringify(value);
}
export function configurationHash(value:unknown){return createHash('sha256').update(canonicalConfiguration(value)).digest('hex')}
