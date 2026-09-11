import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../shared/error-message.ts';
test('failures display Chinese while preserving HTTP and error codes', () => {
  for (const code of [401,402,403,429,500]) {
    const result = errorMessage(`HTTP ${code}`);
    assert.match(result, /[\u3400-\u9fff]/);
    assert.ok(result.includes(`HTTP ${code}`));
  }
  assert.match(errorMessage('TypeError: Failed to fetch'), /网络连接失败/);
  assert.match(errorMessage('missing acknowledgement'), /尚未确认/);
  assert.match(errorMessage('retry_exhausted'), /自动重试上限/);
  assert.match(errorMessage('Unexpected response body'), /操作失败/);
  assert.match(errorMessage('连续重试后仍无法读取当前达人的 TA 的作品侧栏（timeout）'), /作品列表加载失败/);
  assert.equal(errorMessage('当前点赞 200，低于规则下限'), '当前点赞 200，低于规则下限');
  assert.equal(errorMessage('S · AI内容 · Vlog'), 'S · AI内容 · Vlog');
  assert.equal(errorMessage(''), '');
});
