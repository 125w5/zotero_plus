import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDroppedAnswer} from '../../chrome/content/zotero/research/shared/reader-message-drop.mjs';

test('embedded PDF drops resolve real shared answers and their questions by stable IDs',()=>{
 const session={id:'s',messages:[{id:'q',role:'user',text:'为什么要独立测试？'},{id:'a',role:'assistant',text:'核验泛化。',sources:[]}]};
 const conversations={get:id=>id==='s'?session:null},data={getData:()=>JSON.stringify({sessionID:'s',messageID:'a',text:'外部内容'})};
 const answer=resolveDroppedAnswer(data,conversations);
 assert.equal(answer.sessionID,'s');assert.equal(answer.message.text,'核验泛化。');assert.equal(answer.message.question,'为什么要独立测试？');
 assert.equal(session.messages[1].question,undefined,'不会改写已保存的消息');
});

test('external, blank and user messages cannot become PDF annotations',()=>{
 const session={id:'s',messages:[{id:'q',role:'user',text:'问题'},{id:'blank',role:'assistant',text:'   '}]},conversations={get:id=>id==='s'?session:null};
 for(const value of ['', 'invalid', JSON.stringify({sessionID:'s',messageID:'outside',text:'外部正文'}),JSON.stringify({sessionID:'s',messageID:'q'}),JSON.stringify({sessionID:'s',messageID:'blank'})])
  assert.equal(resolveDroppedAnswer({getData:()=>value},conversations),null);
});
