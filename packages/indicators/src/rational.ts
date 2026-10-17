import {parseFixed,formatFixed} from '@vcp/domain';
const abs=(n:bigint)=>n<0n?-n:n;
function gcd(a:bigint,b:bigint):bigint{while(b){const r=a%b;a=b;b=r}return a||1n}
/** Exact rational intermediates; round only at the persistence/wire boundary. */
export class Q {
 readonly n:bigint;readonly d:bigint;
 constructor(n:bigint|number,d:bigint|number=1){let a=BigInt(n),b=BigInt(d);if(b===0n)throw new Error('ZERO_DENOMINATOR');if(b<0n){a=-a;b=-b}const g=gcd(abs(a),b);this.n=a/g;this.d=b/g}
 static decimal(s:string){return new Q(parseFixed(s,8,24),100000000n)}
 add(v:Q){return new Q(this.n*v.d+v.n*this.d,this.d*v.d)}
 sub(v:Q){return new Q(this.n*v.d-v.n*this.d,this.d*v.d)}
 mul(v:Q){return new Q(this.n*v.n,this.d*v.d)}
 div(v:Q){return new Q(this.n*v.d,this.d*v.n)}
 compare(v:Q){const n=this.n*v.d-v.n*this.d;return n<0n?-1:n>0n?1:0}
 abs(){return new Q(abs(this.n),this.d)}
 fixed(scale=8){const n=abs(this.n)*10n**BigInt(scale);const rounded=n/this.d+(n%this.d*2n>=this.d?1n:0n);return formatFixed(this.n<0n?-rounded:rounded,scale)}
}
export const mean=(v:Q[])=>v.reduce((a,b)=>a.add(b),new Q(0)).div(new Q(v.length));
export const max=(v:Q[])=>v.reduce((a,b)=>a.compare(b)>0?a:b);
export const min=(v:Q[])=>v.reduce((a,b)=>a.compare(b)<0?a:b);
export const median=(v:Q[])=>{const sorted=[...v].sort((a,b)=>a.compare(b));const m=sorted.length/2;return sorted.length%2?sorted[Math.floor(m)]!:sorted[m-1]!.add(sorted[m]!).div(new Q(2))};
