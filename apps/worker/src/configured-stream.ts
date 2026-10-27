export interface ManagedStream {cycle:()=>Promise<void>;stop:()=>Promise<void>}
/** Serializes account changes, closing the old socket/lease before starting the replacement. */
export class ConfiguredStream {
 private current:{account:string;stream:ManagedStream}|null=null;
 private active:Promise<void>|null=null;
 private stopped=false;
 constructor(private account:()=>Promise<string|undefined>,private create:(account:string)=>ManagedStream){}
 cycle(){if(this.stopped)return Promise.resolve();if(this.active)return this.active;this.active=this.run().finally(()=>{this.active=null});return this.active}
 private async disconnect(){const current=this.current;this.current=null;await current?.stream.stop()}
 private async run(){
  try{const account=await this.account();if(this.stopped)return;
   if(account!==this.current?.account)await this.disconnect();if(this.stopped||!account)return;
   if(!this.current)this.current={account,stream:this.create(account)};
   await this.current.stream.cycle();
  }catch{await this.disconnect()}
 }
 async stop(){this.stopped=true;await this.active;await this.disconnect()}
}
