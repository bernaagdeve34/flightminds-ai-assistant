/* Seed IST flights for today + next 5 days using MongoDB native driver (no Prisma/transactions)
   Usage:
     1) npm i mongodb
     2) node scripts/seed-mongo-native.cjs
   Env (optional):
     MONGO_URL=mongodb://localhost:27017
     MONGO_DB=ist_flight
     SEED_DAYS=6
*/
const { MongoClient } = require('mongodb');

function randInt(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function pick(a){return a[randInt(0,a.length-1)];}
function toIso(y,m,d,hh,mm){ return new Date(y,m-1,d,hh,mm,0,0).toISOString(); }

const airlines=[{code:"TK",name:"Turkish Airlines"},{code:"PC",name:"Pegasus"},{code:"XQ",name:"SunExpress"},{code:"W6",name:"Wizz Air"},{code:"LH",name:"Lufthansa"},{code:"LY",name:"EL AL"}];
const cities=["Ankara","London","Berlin","Paris","Amsterdam","Rome","Vienna","Zurich","Baku","Tuzla","Antalya","Izmir"];

function statusDb(s){return ({On_Time:"On_Time",Delayed:"Delayed",Cancelled:"Cancelled",Boarding:"Boarding",Landed:"Landed"})[s]||"On_Time";}

function computeStatusAndEstimated(schedIso, direction, baseNow){
  const sched=new Date(schedIso); const diffMin=Math.round((sched-baseNow)/60000);
  let status="On_Time", est=schedIso;
  if(diffMin<-60){ status=Math.random()<0.08?"Cancelled":"Landed"; est=status==="Cancelled"?null:schedIso; }
  else if(diffMin<0){ const delay=randInt(0,25); status=delay>10?"Delayed":"Landed"; est=new Date(new Date(schedIso).getTime()+delay*60000).toISOString(); }
  else if(diffMin<=30 && direction==="Departure"){ const delay=randInt(0,20); status=delay>5?"Delayed":"Boarding"; est=new Date(new Date(schedIso).getTime()+delay*60000).toISOString(); }
  else { if(Math.random()<0.15){ const delay=randInt(5,30); status="Delayed"; est=new Date(new Date(schedIso).getTime()+delay*60000).toISOString(); } }
  return { status, est };
}

function buildDayDocs(dayDate, baseNo){
  const y=dayDate.getFullYear(), m=dayDate.getMonth()+1, d=dayDate.getDate();
  const baseNow=new Date(); baseNow.setHours(12,0,0,0);
  const docs=[];
  for(let i=0;i<6;i++){
    const al=pick(airlines), dest=pick(cities);
    const fn=`${al.code}${baseNo+i}`;
    const hour=7+i*1.2, hh=Math.floor(hour), mm=Math.round((hour-hh)*60);
    const sched=toIso(y,m,d,hh,mm); const {status,est}=computeStatusAndEstimated(sched,"Departure",baseNow);
    docs.push({ airportCode:"IST", flightNumber:fn, airline:al.name, direction:"Departure", originCity:"Istanbul", destinationCity:dest,
      scheduledTimeLocal:sched, estimatedTimeLocal:est, status:statusDb(status), source:"seed:realistic", fetchedAt:new Date(), createdAt:new Date(), updatedAt:new Date() });
  }
  for(let i=0;i<6;i++){
    const al=pick(airlines), orig=pick(cities);
    const fn=`${al.code}${baseNo+500+i}`;
    const hour=9+i*1.1, hh=Math.floor(hour), mm=Math.round((hour-hh)*60);
    const sched=toIso(y,m,d,hh,mm); const {status,est}=computeStatusAndEstimated(sched,"Arrival",baseNow);
    docs.push({ airportCode:"IST", flightNumber:fn, airline:al.name, direction:"Arrival", originCity:orig, destinationCity:"Istanbul",
      scheduledTimeLocal:sched, estimatedTimeLocal:est, status:statusDb(status), source:"seed:realistic", fetchedAt:new Date(), createdAt:new Date(), updatedAt:new Date() });
  }
  return docs;
}

(async () => {
  const url=process.env.MONGO_URL || 'mongodb://localhost:27017';
  const dbName=process.env.MONGO_DB || 'ist_flight';
  const days=Number(process.env.SEED_DAYS || 6);
  const client=new MongoClient(url);
  await client.connect();
  const db=client.db(dbName);
  const col=db.collection('Flight');

  const start=new Date(); start.setHours(0,0,0,0);
  for(let i=0;i<days;i++){
    const day=new Date(start.getFullYear(), start.getMonth(), start.getDate()+i);
    const y=day.getFullYear(), m=day.getMonth()+1, d=day.getDate();
    const dayStart=new Date(y,m-1,d,0,0,0,0).toISOString();
    const dayEnd=new Date(y,m-1,d+1,0,0,0,0).toISOString();
    await col.deleteMany({ airportCode:'IST', scheduledTimeLocal: { $gte: dayStart, $lt: dayEnd } });
    const docs=buildDayDocs(day, 1000+i*20);
    if(docs.length) await col.insertMany(docs);
    console.log('Seeded', day.toDateString(), '->', docs.length, 'flights');
  }
  await client.close();
  console.log('Done.');
})().catch((e)=>{ console.error(e); process.exit(1); });
