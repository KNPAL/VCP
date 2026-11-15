// Unknown capital changes are excluded; never infer a factor from a price jump.
export function classifyNseAction(subject){
 const value=String(subject??'').trim().replace(/\s+/g,' ');
 if(/demerg|rights|scheme|arrang|amalg|merger|reduction|consolid/i.test(value))return {kind:'UNSUPPORTED',reason:value};
 const bonus=/^Bonus\s+(\d+)\s*:\s*(\d+)$/i.exec(value);
 if(bonus){const added=BigInt(bonus[1]),before=BigInt(bonus[2]);if(added>0n&&before>0n)return {kind:'BONUS',sharesBefore:String(before),sharesAfter:String(before+added)};return {kind:'UNSUPPORTED',reason:value}}
 const split=/^Face Value Split \(Sub-Division\) - From Rs\s*(\d+)\/- Per Share To (?:Rs|Re)\s*(\d+)\/- Per Share$/i.exec(value);
 if(split&&BigInt(split[1])>BigInt(split[2])&&BigInt(split[2])>0n)return {kind:'SPLIT',sharesBefore:split[2],sharesAfter:split[1]};
 if(/bonus|split/i.test(value))return {kind:'UNSUPPORTED',reason:value};
 if(/^(?:(?:interim|final|special)\s*)?dividend\b|^annual general meeting\b|^buy\s*back\b/i.test(value))return {kind:'NO_SPLIT_BONUS_ADJUSTMENT'};
 return {kind:'UNSUPPORTED',reason:value};
}
