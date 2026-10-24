import type {Prisma,PrismaClient} from '@prisma/client';
export type PaperDatabase=PrismaClient|Prisma.TransactionClient;
/** A session owns one atomic transaction; its component operations reuse that transaction. */
export function paperTransaction<T>(db:PaperDatabase,operation:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
 return '$transaction' in db?db.$transaction(operation,{timeout:120000}):operation(db);
}
