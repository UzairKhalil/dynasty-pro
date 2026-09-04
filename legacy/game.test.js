const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const store={};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  w.storage={get:k=>store[k]!==undefined?Promise.resolve({key:k,value:store[k]}):Promise.reject(),
             set:(k,v)=>{store[k]=v;return Promise.resolve({key:k,value:v});}};
}});
const w=dom.window,d=w.document;
const $=s=>d.querySelector(s), cells=()=>[...d.querySelectorAll('.cell')];
const click=n=>n.dispatchEvent(new w.Event('click',{bubbles:true}));
let fails=0; const ok=(c,m)=>{console.log((c?'  PASS  ':'  FAIL  ')+m); if(!c)fails++;};
let seed=99; const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);

(async()=>{
  await new Promise(r=>setTimeout(r,60));
  console.log('--- four players ---');
  ok([...d.querySelectorAll('.seat')].length===4,'four seats');
  ok(d.querySelectorAll('.masthead .names span').length===4,'four names in the key');
  ok([...d.querySelectorAll('#setup .chip')].length===7,'six pairings + winner-stays toggle');
  const chipText=[...d.querySelectorAll('#setup .chip')].map(c=>c.textContent);
  ok(chipText.filter(t=>t.includes('Maryam')).length===3,'Maryam appears in 3 pairings: '+chipText.filter(t=>t.includes('Maryam')));
  ok($('#h2h').children.length===6,'six head-to-head rows');
  ok($('#standings').children.length===4,'four standings rows');
  const seatMarks=[...d.querySelectorAll('.seat-mark')].map(s=>s.querySelector('path').getAttribute('d').slice(0,8));
  ok(new Set(seatMarks).size===4,'four distinct mark shapes: '+seatMarks.join(' | '));

  console.log('\n--- free-for-all 6x6 ---');
  click($('#mode-free'));
  ok(cells().length===36,'36 cells');
  ok($('#cells').style.gridTemplateRows.replace(' ','')==='repeat(6,1fr)','rows declared: '+$('#cells').style.gridTemplateRows);
  const order=[];
  for(let i=0;i<4;i++){ order.push($('#headline').textContent.split("'")[0]); click(cells()[i*6]); }
  ok(order.join(',')==='Uzair,Maryam,Zahra,Zain','turn order cycles all four: '+order.join(' > '));
  click($('#mode-duel'));

  console.log('\n--- king of the hill across four ---');
  // Uzair v Maryam first; force a Uzair win on the top row
  click([...d.querySelectorAll('#setup .chip')][0]);
  ok($('#headline').textContent.includes('Uzair'),'duel starts Uzair v Maryam');
  [0,3,1,4,2].forEach(i=>click(cells()[i]));
  ok($('#headline').textContent.includes('Uzair wins'),'Uzair wins: '+$('#headline').textContent);
  ok(/Uzair v Zahra/.test($('#headline-sub').textContent),
     'winner holds board, next waiting player steps in: '+$('#headline-sub').textContent);
  const st=[...d.querySelectorAll('.seat-state')].map(s=>s.textContent);
  ok(st[0]==='winner'&&st[1]==='beaten'&&st[2]==='sitting out'&&st[3]==='sitting out','seat states: '+st);

  console.log('\n--- soak: 250 games, mixed modes ---');
  let wins=0,strikes=0,flares=0,maxOff=0;
  for(let g=0;g<250;g++){
    if(rnd()<0.3) click(rnd()<0.5?$('#mode-duel'):$('#mode-free'));
    if(rnd()<0.2){const c=[...d.querySelectorAll('#setup .chip')]; if(c.length>2) click(c[Math.floor(rnd()*6)]);}
    click($('#primary'));
    let guard=0;
    while(guard++<50){
      const open=cells().filter(c=>!c.disabled);
      if(!open.length) break;
      click(open[Math.floor(rnd()*open.length)]);
      if(/wins|Drawn/.test($('#headline').textContent)) break;
    }
    if(/wins/.test($('#headline').textContent)){
      wins++;
      if($('#strike').querySelector('.strike')) strikes++;
      const wonCells=[...d.querySelectorAll('.cell.won')];
      if(wonCells.length>=4||wonCells.length>=3) flares++;
      const p=$('#strike').querySelector('.strike').getAttribute('d').replace(/[ML]/g,' ').trim().split(/[\s,]+/).map(Number);
      const won=wonCells.map(c=>+c.dataset.i), n=Math.sqrt(cells().length), step=100/n;
      const f=Math.min(...won), cx=(f%n+.5)*step, cy=(Math.floor(f/n)+.5)*step;
      const L=Math.hypot(p[2]-p[0],p[3]-p[1])||1;
      maxOff=Math.max(maxOff,Math.abs((p[2]-p[0])*(cy-p[1])-(cx-p[0])*(p[3]-p[1]))/L);
    }
  }
  ok(strikes===wins,`strike drawn on ${strikes}/${wins} wins`);
  ok(flares===wins,`winning run flares on ${flares}/${wins} wins`);
  ok(maxOff<0.02,`strike through cell centres (worst offset ${maxOff.toFixed(4)} board units)`);

  const L=JSON.parse(store['tictactoe:ledger:v3']);
  let bad=0,totP=0; IDS_CHECK(L);
  function IDS_CHECK(L){['uzair','maryam','zahra','zain'].forEach(i=>{const s=L.stats[i];totP+=s.p;if(s.p!==s.w+s.d+s.l)bad++;});}
  ok(bad===0,'played = W+D+L for all four');
  ok(L.stats.maryam.p>0,`Maryam recorded ${L.stats.maryam.p} games, ${L.stats.maryam.w} wins`);
  const h2hKeys=Object.keys(L.h2h);
  ok(h2hKeys.length===6,'six h2h buckets: '+h2hKeys.join(', '));
  console.log('\n'+(fails?fails+' FAILURES':'all assertions passed'));
  process.exit(fails?1:0);
})();
