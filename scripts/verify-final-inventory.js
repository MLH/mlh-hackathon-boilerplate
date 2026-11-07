const fs=require('node:fs');
const {definitions,reviewReport,superseded}=require('./reconcile-inventory-2026-11-07');
const {correctedName}=require('./inventory-name-policy');

async function main(){
  const base=process.env.CHECKOUT_BASE_URL||'https://makecu.dev';
  const status=await fetch(`${base}/api/checkout?action=status`);
  const origin=new URL(status.url).origin;
  const account=JSON.parse(fs.readFileSync('checkout-admin-credentials.production.local.json','utf8')).accounts[0];
  const headers={'content-type':'application/json',origin};
  const login=await fetch(`${origin}/api/checkout`,{method:'POST',headers,body:JSON.stringify({action:'login',username:account.username,password:account.password})});
  if(!login.ok) throw new Error(`Website login verification failed (${login.status}): ${(await login.json()).error||'Unknown error'}`);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  try{
    const response=await fetch(`${origin}/api/checkout`,{method:'POST',headers:{...headers,cookie},body:JSON.stringify({action:'catalog'})});
    if(!response.ok) throw new Error(`Website catalog verification failed (${response.status}).`);
    const {components}=await response.json();
    const normalize=s=>s.trim().toLowerCase();
    const mismatches=[];
    const photosNeeded=[];
    const imageUrls=new Set();
    for(const d of definitions()){
      const matches=components.filter(c=>!superseded(c)&&[d.name,...d.aliases].map(normalize).includes(normalize(c.name)));
      if(matches.length!==1||matches[0].totalQuantity!==d.quantity) mismatches.push(d.name);
      else if(matches[0].imageUrl==='/images/checkout-image-pending.svg') photosNeeded.push(matches[0].name);
      else imageUrls.add(new URL(matches[0].imageUrl,origin).href);
    }
    for(const component of components.filter(superseded)){
      if(component.active || component.totalQuantity!==0) mismatches.push(`Superseded record still offers stock: ${component.name}`);
    }
    for(const component of components){
      if(correctedName(component.name)!==component.name) mismatches.push(`Uncorrected spelling: ${component.name}`);
    }
    for(const name of ['DMM','Small Solderable Prototyping Board','Sonar Altimeter and Echosounder (PING)']){
      if(!components.some(c=>c.name===name&&c.active&&c.totalQuantity>0)) mismatches.push(`Protected item missing: ${name}`);
    }
    const imageFailures=[];
    const urls=[...imageUrls];
    for(let i=0;i<urls.length;i+=4){
      const checks=await Promise.allSettled(urls.slice(i,i+4).map(async url=>{const r=await fetch(url,{method:'HEAD'});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw new Error(url);}));
      checks.forEach((result,index)=>{if(result.status==='rejected')imageFailures.push(urls[i+index]);});
    }
    console.log(JSON.stringify({website:origin,verifiedDefinitions:definitions().length,catalogRecords:components.length,mismatches,verifiedImages:urls.length-imageFailures.length,imageFailures,photosNeeded},null,2));
    if(process.argv.includes('--report') && !mismatches.length && !imageFailures.length){
      const selected=components.filter(c=>photosNeeded.includes(c.name));
      let report=reviewReport({components:selected});
      report=report.replace('\n\n',`\n\nVerified against the live website at ${origin}/checkout/: ${definitions().length} reconciled records match the confirmed counts, ${urls.length-imageFailures.length} distinct image URLs load, and ${photosNeeded.length} reconciled records still need photos. Confirmed follow-up quantities and whole-pack issue units are included.\n\n`);
      report+='\n## Package evidence checked\n\n';
      for(const [label,url] of [['10 level shifter boards per package','https://www.amazon.com/dp/B07F7W91LC'],['3 ESP32 development boards per package','https://www.amazon.com/dp/B0C7C2HQ7P'],['4 TB6612FNG boards per package','https://www.amazon.com/dp/B0F43L7LLD'],['2 VL53L5CX modules per package','https://www.amazon.com/dp/B0GSF96HHH'],['3 ADS1115 boards per package','https://www.amazon.com/dp/B0F1D3KGG2'],['NeoPixel rings: organizer confirmed 9 individual rings','https://www.amazon.com/dp/B0B2D7742J'],['3 FainWan pulse sensors per package','https://www.amazon.com/dp/B09PR3QQVD'],['ELEGOO Super Starter Kit reference','https://us.elegoo.com/products/elegoo-uno-r3-super-starter-kit']])report+=`- [${label}](${url})\n`;
      fs.writeFileSync('INVENTORY_REVIEW_2026-11-07.md',report);
    }
    if(mismatches.length||imageFailures.length)process.exitCode=1;
  }finally{
    await fetch(`${origin}/api/checkout`,{method:'POST',headers:{...headers,cookie},body:JSON.stringify({action:'logout'})});
  }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
