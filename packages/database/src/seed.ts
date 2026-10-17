import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './password.js';
const db = new PrismaClient();
try {
 const login = process.env['OWNER_LOGIN'];
 const file = process.env['OWNER_PASSWORD_FILE'];
 if (!login || !file) throw new Error('OWNER_LOGIN and OWNER_PASSWORD_FILE required; no default owner password');
 const passwordHash = await hashPassword((await readFile(file, 'utf8')).trim());
 const existing = await db.owner.findUnique({where:{login}});
 if (!existing) await db.owner.create({data:{login,passwordHash}});
 console.log(existing ? 'Owner already exists; password unchanged' : 'Owner initialized');
} finally { await db.$disconnect(); }
