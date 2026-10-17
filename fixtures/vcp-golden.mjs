export function goldenSeries(){
 const points=[[0,100],[6,80],[12,98],[18,88.2],[24,97],[30,92.15],[39,96.7]];
 const bars=Array.from({length:310},(_,i)=>{
  const date=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);
  let price=i<200?40+i*0.1:60+(i-200)*0.52;
  if(i>=270){const x=i-270;let p=points[0];let n=points[1];for(let j=0;j<points.length-1;j++)if(x>=points[j][0]&&x<=points[j+1][0]){p=points[j];n=points[j+1];break}price=p[1]+(n[1]-p[1])*(x-p[0])/(n[0]-p[0]);}
  let high=price+0.02,low=price-0.02;
  if([270,282,294].includes(i))high=price;
  if([276,288,300].includes(i))low=price;
  return {session:date,open:price.toFixed(6),close:price.toFixed(6),high:high.toFixed(6),low:low.toFixed(6),volume:i>=305?'20':'100',revision:'fixture-'+i,endedAt:date+'T10:00:00Z',finalizedAt:date+'T10:30:00Z',adjustmentVerified:true};
 });
 return {bars,sessions:bars.map(b=>b.session),asOf:bars.at(-1).finalizedAt,dataRevision:'golden-v1'};
}
