import type { Decision } from '../sidepanel/types';
import { formatLocalDateTime } from '../sidepanel/format';

export function DecisionIpLocation({ decision }: { decision: Decision }) {
  const location = decision.ipLocationStatus === 'available' ? decision.ipLocation?.trim() : '';
  const title = decision.ipLocationCapturedAt
    ? `采集时平台公开 IP 属地 · ${formatLocalDateTime(decision.ipLocationCapturedAt)}`
    : '该条记录采集时的平台公开 IP 属地';
  return <small title={title}>{location ? `IP 属地：${location}` : 'IP 属地未知'}</small>;
}
