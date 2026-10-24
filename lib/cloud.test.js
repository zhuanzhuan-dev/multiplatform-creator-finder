import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIngestBody,
  buildObservationRecord,
  classifyIngestStatus,
  createCloudClient,
  encodeIngestBody,
  functionUrl,
  hashtagsFrom,
  ingestResultSets,
  normalizeAuthorName,
  pairedAuthorHref,
  pairUrlFor,
  recentHistoryUrl,
  shrinkRecordsToByteLimit,
} from "./cloud.js";

test("Douyin IP location reaches the upload record independently of profile city", () => {
  const record = buildObservationRecord({
    observation: { authorName: "Troy", profileUrl: "https://www.douyin.com/user/MS4wLjABAAAAcreator" },
    profile: { ipLocation: "上海", ipLocationText: "IP属地：上海", ipLocationStatus: "available",
      ipLocationSource: "douyin_profile", ipLocationCapturedAt: "2026-10-20T06:40:00.000Z", city: "重庆" },
  });
  assert.equal(record.rpa_feedback.ip_location, "上海");
  assert.equal(record.rpa_feedback.ip_location_text, "IP属地：上海");
  assert.equal(record.rpa_feedback.ip_location_status, "available");
  assert.equal(record.rpa_feedback.ip_location_source, "douyin_profile");
  assert.equal(record.rpa_feedback.ip_location_captured_at, "2026-10-20T06:40:00.000Z");
  const missing = buildObservationRecord({ profile: { city: "重庆", ipLocationStatus: "missing" } });
  assert.equal(missing.rpa_feedback.ip_location, null);
  assert.equal(missing.rpa_feedback.ip_location_status, "missing");
});

test("author name strips leading @ and collapses spaces", () => {
  assert.equal(normalizeAuthorName("@@@  美食日记  "), "美食日记");
});

test("author_href stays empty unless name and href are both present", () => {
  assert.deepEqual(pairedAuthorHref("", "https://www.douyin.com/user/abc"), { author: "", author_href: "" });
  assert.deepEqual(pairedAuthorHref("店长", ""), { author: "店长", author_href: "" });
  assert.deepEqual(
    pairedAuthorHref("@店长", "https://www.douyin.com/user/abc"),
    { author: "店长", author_href: "https://www.douyin.com/user/abc" },
  );
});

test("hashtags keep caption tags and normalize list items", () => {
  assert.deepEqual(
    hashtagsFrom({ hashtags: ["#美食", "探店"], caption: "今晚 #夜宵 真香" }),
    ["#美食", "#探店", "#夜宵"],
  );
});

test("observation record matches ingest contract v2", () => {
  const record = buildObservationRecord({
    observation: {
      contentType: "video",
      videoId: "751234567890",
      caption: "探店 #成都",
      authorName: "@小馆",
      profileUrl: "https://www.douyin.com/user/sec123",
      likes: 4200,
      durationSeconds: 88,
      dwellSeconds: 30,
      beforeUrl: "https://www.douyin.com/?recommend=1&from_nav=1",
      afterUrl: "https://www.douyin.com/?recommend=1&from_nav=1",
      scrollDelta: 800,
      transitionOk: true,
      observedAt: "2026-09-02T12:00:00.000Z",
      hashtags: ["#探店"],
    },
    profile: { authorName: "小馆", profileUrl: "https://www.douyin.com/user/sec123", followers: 12000, averageLikes: 3800 },
    feedIndex: 3,
    runId: "run-1",
    isRelevant: true,
    decision: "keep",
    action: "watch_then_next",
    score: { score: 42, level: "A" },
    extra: { finderDecision: "ACCEPTED", reasons: ["视频 88 秒"] },
  });

  assert.equal(record.contract_version, 2);
  assert.equal(typeof record.record_id, "string");
  assert.ok(record.record_id.length >= 1);
  assert.equal(record.feed_index, 3);
  assert.equal(record.is_relevant, true);
  assert.equal(record.decision, "keep");
  assert.equal(record.action, "watch_then_next");
  assert.equal(record.author, "小馆");
  assert.equal(record.author_href, "https://www.douyin.com/user/sec123");
  assert.equal(record.aweme_id, "751234567890");
  assert.equal(record.like_count, 4200);
  assert.equal(record.duration_seconds, 88);
  assert.equal(record.dwell_seconds, 30);
  assert.equal(record.interest_score, 42);
  assert.equal(record.content_type, "video");
  assert.equal(record.transition_ok, true);
  assert.equal(record.before_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.after_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.scroll_delta, 800);
  assert.ok(record.hashtags.includes("#探店"));
  assert.ok(record.hashtags.includes("#成都"));
  assert.equal(record.rpa_feedback.source, "douyin-feed-finder");
  assert.equal(record.rpa_feedback.followers, 12000);
  for (const key of Object.keys(record)) {
    assert.notEqual(key.toLowerCase(), "cookie");
    assert.notEqual(key.toLowerCase(), "authorization");
  }
});

test("observation transition fields stay empty until the page reports a real result", () => {
  const record = buildObservationRecord({
    observation: { videoId: "751234567890", beforeUrl: "https://www.douyin.com/?recommend=1&from_nav=1" },
    feedIndex: 1,
  });
  assert.equal(record.before_url, "https://www.douyin.com/?recommend=1&from_nav=1");
  assert.equal(record.after_url, "");
  assert.equal(record.scroll_delta, null);
  assert.equal(record.transition_ok, null);
});

test("ingest body uses contract 2 and keeps plugin identity", () => {
  const body = buildIngestBody({
    sessionId: "11111111-2222-4333-8444-555555555555",
    pluginVersion: "1.0.0",
    hostFingerprint: "abcd1234abcd1234",
    startedAt: "2026-09-02T12:00:00.000Z",
    records: [{ record_id: "r1", feed_index: 1, is_relevant: false, decision: "skip", action: "skip" }],
  });
  assert.equal(body.contract_version, 2);
  assert.equal(body.client.plugin_version, "1.0.0");
  assert.equal(body.client.host_fingerprint, "abcd1234abcd1234");
  assert.equal(body.records.length, 1);
  assert.ok(encodeIngestBody(body).includes("\"contract_version\":2"));
});

test("byte limiter halves oversized batches", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, blob: "x".repeat(80) }));
  const encoded = shrinkRecordsToByteLimit(rows, (list) => JSON.stringify(list).padEnd(500_000, "y"));
  assert.ok(encoded.length < rows.length);
  assert.ok(encoded.length >= 1);
});

test("ingest acknowledgement sets accepted and rejected", () => {
  const sets = ingestResultSets({
    accepted: ["a"],
    duplicated: ["b"],
    rejected: [{ id: "c", reason: "bad" }],
  });
  assert.equal(sets.accepted.has("a"), true);
  assert.equal(sets.duplicated.has("b"), true);
  assert.equal(sets.rejected.get("c"), "bad");
});

test("status classification matches no_swipe retry policy", () => {
  assert.equal(classifyIngestStatus(401), "auth_error");
  assert.equal(classifyIngestStatus(429), "retry");
  assert.equal(classifyIngestStatus(400), "rejected");
  assert.equal(classifyIngestStatus(500), "retry");
  assert.equal(classifyIngestStatus(200), "ok");
});

test("cloud urls point at the company SIC API", () => {
  assert.equal(functionUrl("ingest"), "https://fai.zhuanspirit.com/creators/api/functions/v1/ingest");
  assert.equal(pairUrlFor("XK7-P2M"), "https://fai.zhuanspirit.com/creators/pair?code=XK7-P2M");
  assert.equal(recentHistoryUrl(), "https://fai.zhuanspirit.com/creators/recent");
});

test("ingest client posts the no_swipe contract with device token", async () => {
  const calls = [];
  const client = createCloudClient(undefined, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ accepted: ["r1"], duplicated: [], rejected: [] }),
      };
    },
  });
  const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://fai.zhuanspirit.com/creators/api/functions/v1/ingest");
  assert.equal(calls[0].options.headers.authorization, "Bearer nsd_test_token");
  assert.equal(calls[0].options.headers.apikey, undefined);
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.redirect, "manual");
  assert.match(calls[0].options.body, /"contract_version":2/);
});

test("SSO redirects are explicit auth failures", async () => {
  for (const response of [
    { type: "opaqueredirect", status: 0, ok: false },
    { status: 302, ok: false },
  ]) {
    const client = createCloudClient(undefined, { fetchImpl: async () => response });
    const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
    assert.deepEqual(result, {
      ok: false,
      status: 401,
      payload: { error: "company_sso_required" },
    });
  }
});

test("HTML success pages are never treated as upload acknowledgements", async () => {
  const client = createCloudClient(undefined, {
    fetchImpl: async () => new Response("<html><title>登录</title></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });
  const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "non_json_response");
  assert.equal(result.payload.content_type, "text/html; charset=utf-8");
});

test("non-JSON authorization pages are retryable format failures, not device revocation", async () => {
  for (const status of [401, 403]) {
    const client = createCloudClient(undefined, {
      fetchImpl: async () => new Response("<html>SSO</html>", {
        status,
        headers: { "content-type": "text/html" },
      }),
    });
    const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.payload.error, "non_json_response");
    assert.equal(result.payload.upstream_status, status);
  }
});

test("JSON maintenance failures retain the server response contract", async () => {
  const client = createCloudClient(undefined, {
    fetchImpl: async () => new Response(JSON.stringify({ error: "maintenance", retry_after_seconds: 30 }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
  });
  const result = await client.ingest("nsd_test_token", { contract_version: 2, records: [] });
  assert.deepEqual(result, {
    ok: false,
    status: 503,
    payload: { error: "maintenance", retry_after_seconds: 30 },
  });
});

test('observation feedback records its collection source separately from content type',()=>{
 const record=buildObservationRecord({observation:{sourcePlatform:'xingtu',contentType:'video'}});
 assert.equal(record.rpa_feedback.source_platform,'xingtu');
 assert.equal(record.content_type,'video');
});

test('sidebar IP records retain provenance without claiming an extra homepage navigation', () => {
  const record = buildObservationRecord({ profile: { ipLocation: '河南', ipLocationStatus: 'available',
    ipLocationSource: 'douyin_profile_api', ipLocationProfileUrl: 'https://www.douyin.com/user/MS4wExample' } });
  assert.equal(record.rpa_feedback.ip_location, '河南');
  assert.equal(record.rpa_feedback.ip_location_source, 'douyin_profile_api');
  assert.equal(record.rpa_feedback.no_profile_navigation, true);
});


test("feedback evidence never treats truncated or stale profile text as complete", () => {
  const observation={caption:'做饭',authorName:'昵称'};
  assert.equal(buildObservationRecord({observation,profile:{ready:true,bio:'完整简介'}}).rpa_feedback.rule_evidence.profileText,'完整简介');
  assert.equal(buildObservationRecord({observation,profile:{ready:true,stale:true,bio:'旧简介'}}).rpa_feedback.rule_evidence.profileText,null);
  assert.equal(buildObservationRecord({observation,profile:{ready:true,bio:'x'.repeat(12001)}}).rpa_feedback.rule_evidence.profileText,null);
});

test('rule sync verifies the existing device endpoint before asking users to reconnect', async () => {
  for (const [authStatus, authBody, expected] of [
    [200,{ok:true},'rule_sync_service_unavailable'],
    [401,{error:'invalid_session'},'device_authorization_invalid'],
    [401,{error:'device_token_revoked'},'device_token_revoked'],
    [503,{error:'maintenance'},'rule_sync_auth_unconfirmed'],
  ]) {
    const calls=[];
    const client=createCloudClient(undefined,{fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return Response.json(url.endsWith('/plugin_rules_sync') ? {error:'invalid_session'} : authBody,
        {status:url.endsWith('/plugin_rules_sync') ? 401 : authStatus});
    }});
    const result=await client.syncRules('nsd_existing',{configs:[],receipts:[]},'1.1.28');
    assert.equal(result.payload.error,expected);
    assert.equal(calls.length,2);
    assert.ok(calls[1].url.endsWith('/ingest'));
    assert.equal(calls[1].options.headers.authorization,'Bearer nsd_existing');
    const probe=JSON.parse(calls[1].options.body);
    assert.deepEqual(probe.records,[],'authentication probe must never upload business records');
  }
});

test('sync success and explicit revocation need no extra device request', async () => {
  for (const [status,body] of [[200,{pending:[]}],[401,{error:'device_token_revoked'}]]) {
    let calls=0;
    const client=createCloudClient(undefined,{fetchImpl:async()=>{calls++;return Response.json(body,{status})}});
    assert.deepEqual((await client.syncRules('nsd_existing',{})).payload,body);
    assert.equal(calls,1);
  }
});

test('sync connection diagnosis preserves SSO and network uncertainty', async () => {
  for (const outcome of ['network','sso','html']) {
    let calls=0;
    const client=createCloudClient(undefined,{fetchImpl:async()=>{
      if(++calls===1)return Response.json({error:'invalid_session'},{status:401});
      if(outcome==='network')throw Error('Failed to fetch');
      if(outcome==='sso')return new Response(null,{status:302});
      return new Response('<html>gateway</html>',{status:401,headers:{'content-type':'text/html'}});
    }});
    assert.equal((await client.syncRules('nsd_existing',{})).payload.error,
      outcome==='sso'?'company_sso_required':'rule_sync_auth_unconfirmed');
  }
});

test('feedback evidence separates author and content, keeps unknown plays and marks stale/truncated',()=>{
 const observation={authorName:'游戏厨房',caption:'今天做饭',likes:3000,observedAt:'2026-10-24T01:00:00Z'};
 const profile={ready:true,bio:'做饭日记',worksListComplete:true,recentVideos:[{videoId:'v1',text:'美食',likes:4000,playCount:12000,publishedAt:'2026-10-20T00:00:00Z'}]};
 const fields=buildObservationRecord({observation,profile}).rpa_feedback.rule_evidence.fields;
 assert.equal(fields.nickname,'游戏厨房');assert.equal(fields.currentWork.caption,'今天做饭');assert.equal(fields.currentWork.plays,null);
 assert.equal(fields.recentWorks[0].plays,12000);assert.equal(fields.recentWorks[0].publishedAt,'2026-10-20T00:00:00Z');
 assert.equal(fields.observedAt,observation.observedAt);assert.equal(fields.truncated,false);
 const stale=buildObservationRecord({observation,profile:{...profile,stale:true}}).rpa_feedback.rule_evidence.fields;
 assert.equal(stale.profileState,'stale');assert.equal(stale.bio,null);assert.deepEqual(stale.recentWorks,[]);
 const large=buildObservationRecord({observation,profile:{...profile,recentVideos:Array.from({length:20},()=>({text:'x'.repeat(800)}))}}).rpa_feedback.rule_evidence.fields;
 assert.equal(large.recentWorks.length,15);assert.equal(large.worksRead,20);assert.equal(large.truncated,true);assert.equal(large.recentWorks[0].text.length,600);
});
