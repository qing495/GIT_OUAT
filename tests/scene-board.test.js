import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneBoard,sceneWindow,canTarget,highlightParts,relationKey,displayElements,isTypeMatch} from '../scene-board.js';
import {PlaytestApi} from '../api.js';

const game={id:'g',element_takeover_version:1,phase:'WAIT_RESPONSES',narrator:'ai-a',segment:{id:'s',kind:'transition',cloud_ready:true}};
test('only judged foreign transitions permit targets, never protected plays or ending',()=>{
  assert.equal(canTarget(game),true);
  for(const override of [{narrator:'human'},{phase:'WAIT_FOLLOWUP'},{element_takeover_version:null},{card_flow:{kind:'zero'}},{segment:{...game.segment,cloud_ready:false}},{segment:{...game.segment,kind:'ending'}},{segment:{...game.segment,kind:'active_play'}}])assert.equal(canTarget({...game,...override}),false);
  assert.equal(sceneWindow({...game,narrator:'human'}),true);
});
test('codepoint highlight survives emoji and local drafts are target-specific',()=>{
  assert.deepEqual(highlightParts('😀他推门。她走入。',{start_cp:5,end_cp:9}),['😀他推门。','她走入。','']);
  assert.notEqual(relationKey(game,'T06','e1'),relationKey(game,'T06','e2'));
  assert.notEqual(relationKey(game,'T06','e1'),relationKey({...game,segment:{id:'s2'}},'T06','e1'));
});
test('scene projection keeps adverbial, hides complement, and caps the generic board at six cards',()=>{
  const scene={slots:{
    subject:[{id:'s1',role:'subject',category:'event',text:'冲出'},{id:'s2',role:'subject',category:'character',text:'骑士'}],
    predicate:[{id:'p1',role:'predicate',category:'event',text:'奔跑'},{id:'p2',role:'predicate',category:'event',text:'逃离'}],
    object:[{id:'o1',role:'object',category:'thing',text:'木门'},{id:'o2',role:'object',category:'event',text:'破坏'}],
    attribute:[{id:'a1',role:'attribute',category:'aspect',text:'古老'}],
    adverbial:[{id:'x1',role:'adverbial',category:'place',text:'在城堡里'}],
    complement:[{id:'c1',role:'complement',category:'aspect',text:'得很快'}]
  }};
  const selected=displayElements(scene);
  assert.equal(selected.length,6);
  assert.equal(selected.some(item=>item.role==='adverbial'),true);
  assert.equal(selected.some(item=>item.role==='complement'),false);
  assert.deepEqual(selected.slice(0,3).map(item=>item.id),['s2','o1','s1']);
});
test('type-interrupt matches only the target category and never other',()=>{
  const card={category_interrupt:true,category:'thing'};
  assert.equal(isTypeMatch(card,{category:'thing'}),true);
  assert.equal(isTypeMatch(card,{category:'place'}),false);
  assert.equal(isTypeMatch(card,{category:'other'}),false);
  assert.equal(isTypeMatch({category_interrupt:false,category:'thing'},{category:'thing'}),false);
});
test('canceling an active drag clears target state and returns selection to hand',()=>{
  const calls=[];
  const board={drag:{active:true},clearDrag(){this.drag=null;calls.push('clear');},selectCard(id){calls.push(id);},refresh(){calls.push('render');}};
  SceneBoard.prototype.abortDrag.call(board);
  assert.deepEqual(calls,['clear',null,'render']);assert.equal(board.suppressClick,true);
});
test('clearing a drag hides and resets the targeting arrow',()=>{
  const removed=[];
  const previousDocument=globalThis.document;
  globalThis.document={body:{classList:{remove(){}}}};
  const board={drag:null,arrow:{hidden:false,style:{display:'block'},classList:{remove:name=>removed.push(name)}},path:{removeAttribute:name=>removed.push(name)},grid:{querySelectorAll:()=>[]},getGame:()=>({segment:{scenes:[]}}),lockNavigation(){}};
  SceneBoard.prototype.clearDrag.call(board);
  globalThis.document=previousDocument;
  assert.equal(board.arrow.hidden,true);assert.equal(board.arrow.style.display,'none');
  assert.deepEqual(removed,['d','has-target']);
});
test('commit sends exact scene/card/element and relation, no bulk hand data',async()=>{
  let sent;
  const board={confirm:{disabled:false},selected:{scene:{id:'scene'},element:{id:'element'},cardId:'T06'},input:{value:'  钥匙开门。  '},getGame:()=>game,saveDraft(){},async submit(...args){sent=args;}};
  await SceneBoard.prototype.commit.call(board);
  assert.deepEqual(sent,['attempt_takeover',{segment_id:'s',scene_id:'scene',element_id:'element',card_id:'T06',relation_text:'钥匙开门。'}]);
  sent=null;board.confirm.disabled=true;await SceneBoard.prototype.commit.call(board);assert.equal(sent,null);
});
test('matching type target resolves locally without opening relation dialog',async()=>{
  const sent=[];let opened=false;let local;
  const targetGame={id:'g',element_takeover_version:1,phase:'WAIT_RESPONSES',narrator:'ai-a',hand:[{id:'T06',category:'thing',category_interrupt:true}],segment:{id:'s',kind:'transition',cloud_ready:true}};
  const board={blocked:false,getGame:()=>targetGame,selectCard(){},submit(...args){sent.push(args);},onTypeTakeover(value){local=value;},open(){opened=true;}};
  await SceneBoard.prototype.choose.call(board,{id:'scene'},{id:'element',category:'thing'},'T06');
  assert.equal(opened,false);assert.deepEqual(sent,[]);assert.deepEqual(local,{scene:{id:'scene'},element:{id:'element',category:'thing'},cardId:'T06'});
});
test('uncertain on-demand judgment retries original command without another deduction',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const commands=[];let fail=true;
  const api=new PlaytestApi(storage,async(path,options)=>{commands.push(JSON.parse(options.body));if(fail)throw new Error('timeout');return {ok:true,json:async()=>({...game,phase:'WAIT_FOLLOWUP',narrator:'human',segment:null})};});
  await assert.rejects(api.command('attempt_takeover',4,{segment_id:'s',scene_id:'scene',element_id:'element',card_id:'T06',relation_text:'钥匙开门。'}));
  const pending=storage.getItem(api.prefix+'pending');assert.ok(pending);
  fail=false;const view=await api.flush();assert.equal(view.phase,'WAIT_FOLLOWUP');
  assert.deepEqual(commands[0],commands[1]);assert.equal(storage.getItem(api.prefix+'pending'),null);
});
