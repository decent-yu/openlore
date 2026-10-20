import {afterEach,describe,expect,it,vi} from 'vitest';
import {GenericWebhookSender,formatWebhookMessage} from '../src/infrastructure/notifications/generic_webhook/sender.js';
const payload={event:'daily_push.completed' as const,event_id:'test',status:'success' as const,summary:'[精选](https://example.com/article)'};
afterEach(()=>vi.unstubAllGlobals());
describe('Group message delivery',()=>{
 it('uses a native card for the configured Lark compatible host',()=>{
  expect(formatWebhookMessage('https://open.xfchat.iflytek.com/open-apis/bot/v2/hook/test',payload)).toMatchObject({msg_type:'interactive',card:{schema:'2.0',body:{elements:[{tag:'markdown',content:payload.summary}]}}});
 });
 it('keeps generic endpoints on their JSON protocol',()=>expect(formatWebhookMessage('https://example.com/webhook',payload)).toEqual(payload));
 it('does not mark an HTTP-200 platform rejection as sent',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({code:9499,msg:'Bad request'})}));
  expect(await GenericWebhookSender.send('https://open.xfchat.iflytek.com/hook',payload)).toMatchObject({status:'failed',error:{code:'provider_9499'}});
 });
 it('records platform acknowledgement on success',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({code:0,msg:'success'})}));
  expect((await GenericWebhookSender.send('https://open.xfchat.iflytek.com/hook',payload)).status).toBe('sent');
 });
});
