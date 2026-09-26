import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCard,cpSlice,characterCount,handLayout} from '../logic.js';
import {PlaytestApi,ApiError} from '../api.js';

test('multiple positions require selection; a single position auto-selects',()=>{
  const options=[{id:'one',card_id:'key'},{id:'two',card_id:'key'},{id:'three',card_id:'knight'}];
  assert.deepEqual(chooseCard(options,'key'),{cardId:'key',opportunityId:null});
  assert.deepEqual(chooseCard(options,'knight'),{cardId:'knight',opportunityId:'three'});
});
test('server codepoint offsets preserve Chinese and emoji',()=>{
  assert.equal(cpSlice('👩‍🚀骑士拿起钥匙。',3,5),'骑士');
  assert.equal(characterCount('👩‍🚀 骑士\n e\u0301'),4);
  assert.equal(characterCount(' \n\t'),0);
});
test('focus lifts card and pushes adjacent cards without changing order',()=>{
  const rest=handLayout(5), focus=handLayout(5,2);
  assert.ok(focus[2].y<rest[2].y);
  assert.equal(focus[2].angle,0);
  assert.ok(focus[1].x<rest[1].x && focus[3].x>rest[3].x);
  assert.ok(focus[2].layer>Math.max(...rest.map(c=>c.layer)));
});
function memory(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}

test('generated text is published while judge is pending, without confirming',async()=>{
  let release,started;
  const began=new Promise(resolve=>{started=resolve;});
  const waiting=new Promise(resolve=>{release=resolve;});
  const sent=[],views=[],stages=[];
  const draft={mode:'cloud',phase:'WAIT_RESPONSES',revision:2,segment:{id:'t',text:'过渡全文。',cloud_ready:false}};
  const api=new PlaytestApi(memory(),async(path,req)=>{
    const cmd=JSON.parse(req.body);sent.push(cmd.type);
    if(cmd.type==='generate')return {ok:true,json:async()=>draft};
    started();await waiting;
    return {ok:true,json:async()=>({...draft,revision:3,segment:{...draft.segment,cloud_ready:true}})};
  });
  api.onView=view=>views.push(view);api.onStage=stage=>stages.push(stage);
  const result=api.command('generate',1);
  await began;
  assert.equal(views.length,1);
  assert.equal(views[0].segment.text,'过渡全文。');
  assert.equal(views[0].segment.cloud_ready,false);
  assert.deepEqual(stages,['generate','judge']);
  release();await result;
  assert.equal(views[1].segment.cloud_ready,true);
  assert.deepEqual(sent,['generate','judge']);
});

test('v2 AI continuation generates then judges, never auto-confirms',async()=>{
  const sent=[];const api=new PlaytestApi(memory(),async(path,req)=>{
    const body=JSON.parse(req.body);sent.push(body.type);
    const base={rules_version:'transition-v2',mode:'cloud',narrator:'ai-a'};
    const view=body.type==='continue'?{...base,revision:2,phase:'WAIT_TRANSITION'}:body.type==='generate'?{...base,revision:3,phase:'WAIT_RESPONSES',segment:{id:'t',cloud_ready:false}}:{...base,revision:4,phase:'WAIT_RESPONSES',segment:{id:'t',cloud_ready:true}};
    return {ok:true,json:async()=>view};
  });
  const result=await api.command('continue',1);
  assert.deepEqual(sent,['continue','generate','judge']);assert.equal(result.phase,'WAIT_RESPONSES');
});

test('v2 human transition waits for a candidate; zero-card transition is still manual',async()=>{
  for(const hand of [[],[{id:'C01'}]]){
    let count=0;const api=new PlaytestApi(memory(),async()=>{count++;throw new Error('unexpected call');});
    const view={rules_version:'transition-v2',mode:'cloud',narrator:'human',phase:'WAIT_TRANSITION',hand};
    assert.equal(await api.autoJudge(view),view);assert.equal(count,0);
  }
});

test('cloud narration automatically judges and retries only the pending judge',async()=>{
  const storage=memory(),sent=[];let fail=true;
  const pending={mode:'cloud',revision:3,phase:'WAIT_RESPONSES',segment:{id:'new-segment',cloud_ready:false}};
  const api=new PlaytestApi(storage,async(path,req)=>{
    const body=JSON.parse(req.body);sent.push(body);
    if(body.type==='narrate')return {ok:true,json:async()=>pending};
    if(fail){fail=false;throw new Error('timeout');}
    return {ok:true,json:async()=>({...pending,revision:4,segment:{...pending.segment,cloud_ready:true}})};
  });
  await assert.rejects(api.command('narrate',2,{text:'story'}));
  assert.deepEqual(sent.map(x=>x.type),['narrate','judge']);
  assert.equal(api.cached().revision,3);
  const result=await api.command('narrate',2,{text:'must not resend'});
  assert.deepEqual(sent[1],sent[2]);assert.equal(result.segment.cloud_ready,true);
});
test('uncertain result survives reload and replays exactly the same command',async()=>{
  const storage=memory(),sent=[];let first=true;
  const fetcher=async(path,request)=>{
    const body=JSON.parse(request.body||'null');
    if(path.endsWith('/commands')){sent.push(body);if(first){first=false;throw new Error('timeout');}return {ok:true,json:async()=>({revision:2,phase:'SHOW_RESULT'})};}
    return {ok:true,json:async()=>path.endsWith('playtest')?{game:{revision:2,phase:'SHOW_RESULT'}}:{visitor_id:'test'}};
  };
  const api=new PlaytestApi(storage,fetcher);await api.prepare();
  await assert.rejects(api.command('respond',1,{segment_id:'segment',opportunity_id:'point'}));
  const restarted=new PlaytestApi(storage,fetcher);await restarted.sync();
  assert.deepEqual(sent[0],sent[1]);assert.equal(storage.getItem(api.prefix+'pending'),null);
  assert.equal(restarted.cached().revision,2);
});
test('terminal stale-version error clears pending command for explicit resync',async()=>{
  const storage=memory();const api=new PlaytestApi(storage,async()=>({ok:false,status:409,json:async()=>({error:{code:'STALE_VERSION'}})}));
  await assert.rejects(api.command('respond',1),ApiError);
  assert.equal(storage.getItem(api.prefix+'pending'),null);
});
test('type takeover can queue persistence without making a request during the drag',()=>{
  const storage=memory();let calls=0;
  const api=new PlaytestApi(storage,async()=>{calls++;return {ok:true,json:async()=>({})};});
  const command=api.queue('attempt_takeover',7,{segment_id:'s',scene_id:'sc',element_id:'el',card_id:'T06',relation_text:'系统类型约束'});
  assert.equal(calls,0);assert.equal(command.expected_revision,7);assert.equal(JSON.parse(storage.getItem(api.prefix+'pending')).card_id,'T06');
  assert.equal(api.queue('attempt_takeover',7,{}),null);
});

test('fair reset replay clears only playtest drafts, preserving guest identity',async()=>{
  const storage=memory();const api=new PlaytestApi(storage,async()=>({ok:true,json:async()=>({id:'new',rules_version:'fair-v3',phase:'WAIT_TRANSITION',narrator:'human'})}));
  storage.setItem(api.prefix+'guest','same-guest');storage.setItem('other.data','keep');
  storage.setItem('ouat.draft.old.segment','draft');storage.setItem('ouat.draft.older.segment','draft');
  storage.setItem(api.prefix+'pending',JSON.stringify({type:'reset',command_id:'retry'}));
  await api.flush();
  assert.equal(storage.getItem('ouat.draft.old.segment'),null);assert.equal(storage.getItem('ouat.draft.older.segment'),null);
  assert.equal(storage.getItem(api.prefix+'guest'),'same-guest');assert.equal(storage.getItem('other.data'),'keep');
  assert.equal(storage.getItem(api.prefix+'pending'),null);assert.equal(api.cached().id,'new');
});

test('fair AI followup generates then judges without settling automatically',async()=>{
  const sent=[];const api=new PlaytestApi(memory(),async(path,req)=>{
    const cmd=JSON.parse(req.body);sent.push(cmd.type);
    return {ok:true,json:async()=>({rules_version:'fair-v3',mode:'cloud',narrator:'ai-b',phase:'WAIT_RESPONSES',revision:2,segment:{id:'f',cloud_ready:cmd.type==='judge'}})};
  });
  await api.autoJudge({rules_version:'fair-v3',mode:'cloud',narrator:'ai-b',phase:'WAIT_FOLLOWUP',revision:1});
  assert.deepEqual(sent,['generate','judge']);
});

test('fair AI ending is generated and judged, but never automatically confirmed',async()=>{
  const sent=[];const api=new PlaytestApi(memory(),async(path,req)=>{
    const cmd=JSON.parse(req.body);sent.push(cmd.type);
    return {ok:true,json:async()=>({rules_version:'fair-v3',mode:'cloud',narrator:'ai-a',phase:'WAIT_RESPONSES',revision:3,segment:{id:'end',kind:'ending',cloud_ready:cmd.type==='judge'}})};
  });
  await api.autoJudge({rules_version:'fair-v3',mode:'cloud',narrator:'ai-a',phase:'ENDING_READY',revision:1});
  assert.deepEqual(sent,['generate','judge']);
  const finished={rules_version:'fair-v3',mode:'cloud',narrator:'ai-a',phase:'FINISHED'};
  assert.equal(await api.autoJudge(finished),finished);assert.equal(sent.length,2);
});
