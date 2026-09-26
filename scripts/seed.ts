import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db=new PrismaClient();
const merchantId='demo-feicui-merchant';
async function main(){
  await db.merchant.upsert({where:{id:merchantId},create:{id:merchantId,name:'瑞丽演示翡翠摊'},update:{}});
  const users=[
    {login:'boss',name:'演示老板',role:'OWNER',password:'DemoBoss2026!',permissions:{}},
    {login:'staff',name:'录货员工',role:'STAFF',password:'DemoStaff2026!',permissions:{goods:true,loans:true,partners:true,partnersRead:true,stock:true,imports:true}},
    {login:'cashier',name:'收款员工',role:'STAFF',password:'DemoCash2026!',permissions:{goods:true,loans:true,sales:true,receipts:true,partnersRead:true,payments:false}}
  ];
  for(const u of users){const passwordHash=await bcrypt.hash(u.password,12);await db.user.upsert({where:{login:u.login},create:{merchantId,login:u.login,name:u.name,role:u.role,passwordHash,permissions:u.permissions},update:{name:u.name,role:u.role,permissions:u.permissions}})}
  const locations=[];
  for(const name of ['摊位','保险柜','库房'])locations.push(await db.location.upsert({where:{merchantId_name:{merchantId,name}},create:{merchantId,name},update:{}}));
  const defs=[['客户甲','CUSTOMER'],['客户乙','CUSTOMER'],['上游货主甲','OWNER'],['上游货主乙','OWNER'],['同行丙','CUSTOMER|OWNER']];
  const partners=[];
  for(const [name,roles] of defs){let p=await db.partner.findFirst({where:{merchantId,name}});if(!p)p=await db.partner.create({data:{merchantId,name,roles:roles.split('|'),settlementType:roles.includes('OWNER')?'RATE':null,settlementRateBp:roles.includes('OWNER')?8000:null}});partners.push(p)}
  for(const login of ['staff','cashier']){
    const current=await db.user.findUniqueOrThrow({where:{login}});
    if(!Array.isArray((current.permissions as Record<string,unknown>).customerIds))await db.user.update({where:{id:current.id},data:{permissions:{...(current.permissions as Record<string,unknown>),customerIds:[partners[0].id]}}});
  }
  const names=['冰种飘花手镯','阳绿平安扣','糯冰福豆','紫罗兰戒面','墨翠观音','白底青叶子','春带彩牌子','冰晴圆珠','飘绿如意','满绿蛋面'];
  for(let i=1;i<=50;i++){
    const code=`DEMO-${String(i).padStart(3,'0')}`;
    const owner=i>25?partners[2+(i%2)]:null;
    const existing=await db.good.findUnique({where:{merchantId_code:{merchantId,code}}});if(existing)continue;
    const g=await db.good.create({data:{merchantId,code,name:names[(i-1)%names.length],category:i%3===0?'挂件':i%3===1?'手镯':'戒面',ownershipKind:owner?'CONSIGN':'OWN',ownerPartnerId:owner?.id,currentOwnerKind:owner?'PARTNER':'MERCHANT',currentOwnerPartnerId:owner?.id,costCents:owner?null:BigInt(100000+i*1100),askingCents:BigInt(200000+i*2100),floorCents:BigInt(150000+i*1500),settlementType:owner?'RATE':null,settlementRateBp:owner?8000:null,ruleVersion:owner?1:null,holderKind:'MERCHANT',locationId:locations[i%locations.length].id,custodianUserId:(await db.user.findUniqueOrThrow({where:{login:'boss'}})).id}});
    await db.inventoryEvent.create({data:{merchantId,goodId:g.id,action:owner?'CONSIGN_RECEIPT':'OWN_RECEIPT',before:{},after:{holderKind:'MERCHANT',locationId:g.locationId,occupancy:'FREE'},referenceType:'SEED',referenceId:g.id,actorId:g.custodianUserId!}});
  }
  await db.merchant.upsert({where:{id:'isolation-check-merchant'},create:{id:'isolation-check-merchant',name:'隔离测试商家'},update:{}});
  console.log('演示数据就绪：50件货、5个合作方、3个位置、3个登录账号；均明确标记为演示。');
}
main().finally(()=>db.$disconnect());
