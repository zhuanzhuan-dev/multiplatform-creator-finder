import type { Decision } from '../sidepanel/types';
import { formatLocalDateTime } from '../sidepanel/format';

export function DecisionIpLocation({ decision }: { decision: Decision }) {
  if (decision.sourcePlatform && decision.sourcePlatform !== 'douyin' && !decision.ipLocationStatus) return null;
  const location = decision.ipLocationStatus === 'available' ? decision.ipLocation?.trim() : '';
  const unavailable = decision.ipLocationStatus === 'missing' ? '未提供'
    : decision.ipLocationStatus === 'failed' ? '读取失败'
    : '未获取';
  const reason = location ? `采集时平台公开 IP 属地：${location}`
    : decision.ipLocationStatus === 'missing' ? '已读取平台资料，响应中未提供 IP 属地'
    : decision.ipLocationStatus === 'failed' ? 'IP 属地读取失败'
    : decision.ipLocationStatus === 'identity_mismatch' ? '返回的达人身份不匹配，未采用 IP 属地'
    : decision.ipLocationStatus === 'cancelled' ? 'IP 属地采集已取消'
    : '该条记录尚未取得 IP 属地，未获取到有效侧栏响应或历史记录未保存该字段';
  const title = decision.ipLocationCapturedAt ? `${reason} · ${formatLocalDateTime(decision.ipLocationCapturedAt)}` : reason;
  return <span className="decision-ip-location" title={title}>IP {location || unavailable}</span>;
}
