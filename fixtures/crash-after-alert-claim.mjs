import {PrismaClient,claimAlert} from '../packages/database/dist/index.js';
// The drill kills this process after PostgreSQL commits its claim.
if(new URL(process.env.DATABASE_URL).pathname!=='/vcp_test'||!process.send)throw Error('Test database and IPC required');
const db=new PrismaClient(),claim=await claimAlert(db,30000,process.argv[2]);
process.send({claimed:!!claim});
setInterval(()=>{},60000);
