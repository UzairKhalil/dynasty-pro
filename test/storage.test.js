const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
let fails=0; const ok=(c,m)=>{console.log((c?'  PASS  ':'  FAIL  ')+m); if(!c)fails++;};

function run(label, opts){
  return new Promise(res=>{
    const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
      url:'https://example.com', beforeParse:opts.before});
    const w=dom.window,d=w.document;
    setTimeout(()=>{
      const $=s=>d.querySelector(s), cells=[...d.querySelectorAll('.cell')];
      const click=n=>n.dispatchEvent(new w.Event('click',{bubbles:true}));
      [0,3,1,4,2].forEach(i=>click(cells[i]));
      res({w,d,$,note:$('#note').textContent,won:/wins/.test($('#headline').textContent)});
    },60);
  });
}

(async()=>{
  console.log('--- inside Claude (window.storage present) ---');
  const artifactStore={};
  let r=await run('artifact',{before(w){ w.storage={
    get:k=>artifactStore[k]!==undefined?Promise.resolve({key:k,value:artifactStore[k]}):Promise.reject(),
    set:(k,v)=>{artifactStore[k]=v;return Promise.resolve();}}; }});
  ok(r.won,'game plays');
  ok(Object.keys(artifactStore).length===1,'wrote via artifact storage API');
  ok(!/aren't saving/.test(r.note),'no warning shown: "'+r.note+'"');

  console.log('\n--- self-hosted on your own domain (no window.storage) ---');
  r=await run('hosted',{before(w){ /* no w.storage: localStorage path */ }});
  ok(r.won,'game plays');
  const ls=r.w.localStorage.getItem('tictactoe:ledger:v3');
  ok(!!ls,'wrote via localStorage fallback');
  ok(JSON.parse(ls).stats.uzair.w===1,'ledger content correct in localStorage');
  ok(!/aren't saving/.test(r.note),'no warning shown: "'+r.note+'"');

  console.log('\n--- storage blocked entirely (private mode) ---');
  r=await run('blocked',{before(w){
    Object.defineProperty(w,'localStorage',{get(){ throw new Error('blocked'); }}); }});
  ok(r.won,'game still plays');
  ok(/aren't saving/.test(r.note),'honest warning shown: "'+r.note+'"');

  console.log('\n--- portability ---');
  const external=[...html.matchAll(/https?:\/\/[^"' )]+/g)].map(m=>m[0]);
  const fetched=external.filter(u=>!u.includes('w3.org'));
  ok(fetched.every(u=>u.includes('fonts.g')),'only network request is Google Fonts ('+new Set(fetched).size+' urls; w3.org is the SVG namespace, not a fetch)');
  ok(!/src=|<script src/.test(html.replace(/<script>/g,'')),'no external scripts');
  ok(fs.statSync(require('path').join(__dirname,'..','index.html')).size<40000,
     'single file, '+Math.round(fs.statSync(require('path').join(__dirname,'..','index.html')).size/1024)+'KB');
  console.log('\n'+(fails?fails+' FAILURES':'all assertions passed'));
})();
