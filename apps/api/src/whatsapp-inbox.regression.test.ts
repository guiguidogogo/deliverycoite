import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from './app.js';
import { prisma } from './utils/prisma.js';
import { env } from './utils/env.js';
const calls: unknown[][]=[];
(prisma.$queryRawUnsafe as any)=async (...args: unknown[])=>{calls.push(args); return [];};
(prisma.$executeRawUnsafe as any)=async (...args: unknown[])=>{calls.push(args); return 1;};
(prisma.company.findUnique as any)=async ()=>({id:'shop-a'});
let role='ADMIN';
(prisma.user.findUnique as any)=async ()=>({id:'tester',active:true,role,companyId:'shop-a',company:{active:true},staffRole:{permissions:[]}});
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
const token=jwt.sign({sub:'tester',companyId:'shop-a'},env.jwtSecret);
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
const request=(path:string,init:RequestInit={})=>fetch(base+path,{...init,signal:AbortSignal.timeout(2000)});
try {
 for(const path of ['/admin/whatsapp/inbox/conversations','/admin/whatsapp/inbox/labels','/admin/whatsapp/inbox/quick-replies']) {
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,{headers})).status,200);
 }
 assert(calls.filter(c=>String(c[0]).startsWith('SELECT')||String(c[0]).includes('SELECT m.phone')).every(c=>c[1]==='shop-a'));
 role='ATTENDANT'; assert.equal((await request('/admin/whatsapp/inbox/conversations',{headers})).status,403); role='ADMIN';
 process.env.WHATSAPP_INBOX_WEBHOOK_SECRET='local-test-secret';
 const before=calls.length;
 assert.equal((await request('/webhooks/whatsapp/inbox',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 assert.equal(calls.length,before);
 assert.equal((await request('/webhooks/whatsapp/inbox',{method:'POST',headers:{'content-type':'application/json','x-webhook-secret':'local-test-secret'},body:JSON.stringify({tenant_id:'shop-a',from:'5571992294907',id:'test-new',text:'mensagem de teste'})})).status,204);
 assert(calls.some(c=>String(c[0]).includes('INSERT INTO whatsapp_inbox_messages') && c.includes('test-new')&&c.includes('shop-a')));
 const readPath='/admin/whatsapp/inbox/messages/5571992294907/read';
 assert.equal((await request(readPath,{method:'POST',headers,body:JSON.stringify({ids:[]})})).status,400);
 assert.equal((await request(readPath,{method:'POST',headers,body:JSON.stringify({ids:['visible-message']})})).status,200);
 const update=calls.find(c=>String(c[0]).includes('UPDATE whatsapp_inbox_messages SET read_at'))!;
 assert.equal(update[1],'shop-a'); assert.equal(update[2],'5571992294907'); assert.equal(update[3],'["visible-message"]');
 assert(String(update[0]).includes("direction = 'in' AND read_at IS NULL"));
 assert.equal((await request('/webhooks/whatsapp/inbox',{method:'POST',headers:{'content-type':'application/json','x-webhook-secret':'local-test-secret'},body:JSON.stringify({tenant_id:'shop-a',from:'5571992294907',id:'test-quote',text:'este',quotedMessage:{id:'original',text:'Qual produto?',messageType:'text'}})})).status,204);
 const insert=calls.find(c=>String(c[0]).includes('INSERT INTO whatsapp_inbox_messages')&&c.includes('test-quote'))!;
 assert.equal(JSON.parse(String(insert[10])).id,'original');
 assert.equal((await request('/admin/whatsapp/inbox/send',{method:'POST',headers,body:JSON.stringify({phone:'5571992294907',message:''})})).status,400);
 console.log('PASS: routes respond; authentication; authorization; tenant isolation; authenticated receive; send validation');
} finally {server.closeAllConnections();server.close();await prisma.$disconnect();}
