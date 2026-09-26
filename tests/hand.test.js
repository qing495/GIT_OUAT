import test from 'node:test';
import assert from 'node:assert/strict';
import {HandView} from '../hand.js';
import {TablePresentation} from '../table.js';
import {PlaytestApi} from '../api.js';

function fixture(){
  const host={children:[],replaceChildren(){this.children=[];},insertBefore(node,before){this.children=this.children.filter(n=>n!==node);const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);}};
  let creates=0;const moved=[];
  const hand=new HandView(host,card=>{creates++;return {id:card.id,remove(){host.children=host.children.filter(n=>n!==this);}};},(node,card)=>node.label=card.label);
  hand.flyOut=node=>moved.push(node.id);
  return {host,hand,moved,creates:()=>creates};
}
const cards=[{id:'a'},{id:'b'},{id:'ending',ending:true}];
test('status refresh preserves card nodes and creates no entry animations',()=>{
  const f=fixture();f.hand.sync('one',cards);const nodes=[...f.host.children];
  for(let n=0;n<5;n++)f.hand.sync('one',cards.map(c=>({...c,label:'updated'})),{animate:true});
  assert.equal(f.creates(),3);assert.deepEqual(f.host.children,nodes);assert.equal(f.hand.entering.length,0);
});
test('committed removal flies once; draw only enters the new card; ending remains stable',()=>{
  const f=fixture();f.hand.sync('one',cards);const ending=f.host.children[2],survivor=f.host.children[1];
  const after=[cards[1],{id:'new'},cards[2]];f.hand.sync('one',after,{animate:true});
  assert.deepEqual(f.moved,['a']);assert.equal(f.host.children[0],survivor);assert.equal(f.host.children[2],ending);
  assert.deepEqual(f.hand.entering.map(n=>n.id),['new']);f.hand.entering=[];
  f.hand.sync('one',after,{animate:true});assert.deepEqual(f.moved,['a']);assert.equal(f.hand.entering.length,0);
});
test('snapshot hydration and different games do not replay drawing',()=>{
  const f=fixture();f.hand.sync('one',cards);f.hand.sync('one',[...cards,{id:'new'}]);
  assert.equal(f.hand.entering.length,0);f.hand.sync('two',cards,{animate:true});assert.equal(f.hand.entering.length,0);
});
test('reduced motion skips entering animations and game changes cancel transfers',()=>{
  const f=fixture();f.hand.sync('one',cards);f.hand.reduced=()=>true;
  f.hand.sync('one',[...cards,{id:'new'}],{animate:true});
  f.hand.entered({});assert.equal(f.hand.entering.length,0);assert.equal(f.hand.transfers.size,0);
  let canceled=0;f.hand.transfers.add({cancel(){canceled++;}});
  f.hand.sync('two',cards);assert.equal(canceled,1);assert.equal(f.hand.transfers.size,0);
});
test('director preview is text only; committed AI card is presented once',()=>{
  const table=Object.create(TablePresentation.prototype);Object.assign(table,{seen:new Set(),playing:false,ticket:0});
  const base={id:'game',phase:'WAIT_ACTION'};
  const preview={...base,phase:'WAIT_RESPONSES',segment:{id:'segment',kind:'active_play',text:'A sentence',target:{name:'card'},narrator:'ai-a'}};
  table.accept(base,preview);assert.equal(table.queue.card,null);
  const result={...base,phase:'SHOW_RESULT',result:{id:'segment',played:[{participant:'ai-a',card:{name:'card'}}]}};
  table.accept(preview,result);assert.equal(table.queue.kind,'committed');table.queue=null;table.playing=false;
  table.accept(result,{...result,revision:99});assert.equal(table.queue,null);
  table.accept(result,result,true);assert.equal(table.queue,null);
});
test('card flow blocks automatic AI generation even with a resumable narrator phase',async()=>{
  const api=new PlaytestApi({},()=>{throw Error('must not call');});
  const view={rules_version:'fair-v3',mode:'cloud',narrator:'ai-a',phase:'WAIT_ACTION',card_flow:{kind:'zero'}};
  assert.equal(await api.autoJudge(view),view);
});
test('resuming a queued command hydrates snapshots without replaying its animation',async()=>{
  const data=new Map([['ouat.web.v1.guest','test'],['ouat.web.v1.pending',JSON.stringify({type:'begin_exchange',command_id:'retry'})]]);
  const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const view={id:'game',phase:'WAIT_EXCHANGE_DISCARD',card_flow:{kind:'exchange'},hand:[{id:'new'}]};
  const api=new PlaytestApi(storage,async(path)=>({ok:true,json:async()=>path==='/v1/playtest'?{game:view}:view}));
  const snapshots=[];api.onView=(v,meta)=>snapshots.push(meta.snapshot);
  assert.equal(await api.sync(),view);assert.deepEqual(snapshots,[true,true]);assert.equal(api.hydrating,false);
});
