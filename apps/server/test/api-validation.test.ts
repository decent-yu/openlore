import { afterAll, beforeAll, expect, it } from 'vitest';
import { initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { createServer } from '../src/http/server.js';

let app: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => { initDatabase(); app = await createServer(); });
afterAll(async () => { await app.close(); });

it('rejects malformed source URLs and empty names before persisting them', async () => {
  for (const payload of [{name: '', url: 'https://example.com/rss'}, {name: 'Invalid', url: 'not-a-url'}, {name:'Invalid',url:'file:///etc/passwd'}]) {
    const response = await app.inject({method:'POST',url:'/api/v1/sources',payload});
    expect(response.statusCode).toBe(400);
  }
  const sources = (await app.inject({method:'GET',url:'/api/v1/sources'})).json();
  expect(sources.every((source: {name:string}) => source.name !== 'Invalid')).toBe(true);
});

it('preserves source configuration when only its description changes', async () => {
  const created = (await app.inject({method:'POST',url:'/api/v1/sources',payload:{name:'Saved source',url:'https://example.com/rss',enabled:false}})).json();
  const response = await app.inject({method:'PATCH',url:`/api/v1/sources/${created.id}`,payload:{description:'Updated description'}});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({name:'Saved source',url:'https://example.com/rss',enabled:false,description:'Updated description'});
});

it('returns validation errors for fractional and invalid pagination', async () => {
  for (const query of ['page=1.5','page=-1','page=bad','page_size=101']) {
    const response = await app.inject({method:'GET',url:`/api/v1/library?${query}`});
    expect(response.statusCode).toBe(400);
  }
});

it('reports invalid report configuration as a validation error', async () => {
  const response = await app.inject({method:'POST',url:'/api/v1/reports',payload:{name:'Invalid enabled report',enabled:true,pipeline_ids:[],notification_connection_id:null}});
  expect(response.statusCode).toBe(400);
  expect(response.json().error.message).toContain('请选择任务');
});
it('rejects malformed notification URLs before saving credentials',async()=>{
  const response=await app.inject({method:'POST',url:'/api/v1/settings/connections/notification',payload:{name:'Invalid notification',webhookUrl:'not-a-url'}});
  expect(response.statusCode).toBe(400);
});
it('protects notification channels referenced by report plans',async()=>{
  const channel=(await app.inject({method:'POST',url:'/api/v1/settings/connections/notification',payload:{name:'Protected channel',webhookUrl:'https://example.com/hook'}})).json();
  const plan=(await app.inject({method:'POST',url:'/api/v1/reports',payload:{name:'Protected report',enabled:false,pipeline_ids:[],notification_connection_id:channel.id}})).json();
  const blocked=await app.inject({method:'DELETE',url:`/api/v1/settings/connections/notification/${channel.id}`});
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json().error.message).toContain('Protected report');
  await app.inject({method:'DELETE',url:`/api/v1/reports/${plan.id}`});
  expect((await app.inject({method:'DELETE',url:`/api/v1/settings/connections/notification/${channel.id}`})).statusCode).toBe(200);
});
