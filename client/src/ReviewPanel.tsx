import { NodeRuntime, ReviewSnapshot, ReviewStatus } from './types';

interface ReviewPanelProps {
  /** 模拟开始时冻结的排程快照（模拟期间编辑与现场续排均不改写） */
  snapshot: ReviewSnapshot;
  /** 最新运行记录（暂停时为当前时刻的中间状态；结束时全部完成） */
  runtime: Record<string, NodeRuntime>;
  /** 当前模拟时刻（秒） */
  simTime: number;
  /** 模拟是否已结束（false：暂停中查看的中间复盘） */
  finished: boolean;
  onClose: () => void;
}

interface ReviewRow {
  nodeId: string;
  name: string;
  plannedStart: number;
  plannedEnd: number;
  actualStart?: number;
  actualEnd?: number;
  status: ReviewStatus;
  /** 是否已经执行完成（暂停时执行中的口令不计入完成数） */
  completed: boolean;
}

const EPS = 1e-9;

/**
 * 执行复盘（只读）：对照开始时冻结的排程快照，列出每条口令的
 * 计划起止、实际起止、开始/结束偏差与状态（按时 / 延迟 / 未执行），
 * 已开始口令按实际开始时间排序，未执行口令排在最后（按计划开始时间）。
 * 总览给出完成数、最大开始延迟与总工期偏差。复盘不写回项目。
 */
export function ReviewPanel(props: ReviewPanelProps) {
  const { snapshot, runtime, simTime, finished } = props;

  const rows: ReviewRow[] = snapshot.commands.map((c) => {
    const rt = runtime[c.nodeId];
    if (rt && (rt.status === 'running' || rt.status === 'done') && rt.start !== undefined) {
      const startDelta = rt.start - c.plannedStart;
      const status: ReviewStatus = startDelta > EPS ? 'delayed' : 'onTime';
      return {
        nodeId: c.nodeId,
        name: c.name,
        plannedStart: c.plannedStart,
        plannedEnd: c.plannedEnd,
        actualStart: rt.start,
        actualEnd: rt.end,
        status,
        completed: rt.status === 'done',
      };
    }
    return {
      nodeId: c.nodeId,
      name: c.name,
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      status: 'notRun',
      completed: false,
    };
  });

  // 按实际开始时间排序；未执行口令排在最后，内部按计划开始时间
  rows.sort((a, b) => {
    if (a.status === 'notRun' && b.status === 'notRun') {
      return a.plannedStart !== b.plannedStart
        ? a.plannedStart - b.plannedStart
        : a.nodeId < b.nodeId
          ? -1
          : 1;
    }
    if (a.status === 'notRun') return 1;
    if (b.status === 'notRun') return -1;
    const sa = a.actualStart ?? 0;
    const sb = b.actualStart ?? 0;
    return sa !== sb ? sa - sb : a.nodeId < b.nodeId ? -1 : 1;
  });

  const doneCount = rows.filter((r) => r.completed).length;
  const runningCount = rows.filter((r) => r.actualStart !== undefined && !r.completed).length;
  const delayedCount = rows.filter((r) => r.status === 'delayed').length;
  const notRunCount = rows.filter((r) => r.status === 'notRun').length;

  // 最大延迟：已开始口令的开始偏差最大值（全部按时则为 0）
  let maxDelay = 0;
  for (const r of rows) {
    if (r.actualStart !== undefined) {
      maxDelay = Math.max(maxDelay, r.actualStart - r.plannedStart);
    }
  }

  // 总工期偏差：实际整体完成时刻（取已开始口令的实际结束最大值，
  // 暂停中可能晚于当前时钟；未开始则取当前时刻）- 冻结计划总工期
  let actualMakespan = finished ? 0 : simTime;
  for (const r of rows) {
    if (r.actualEnd !== undefined) actualMakespan = Math.max(actualMakespan, r.actualEnd);
  }
  const makespanDelta = actualMakespan - snapshot.plannedMakespan;

  return (
    <div className="replan-overlay" onPointerDown={props.onClose}>
      <div className="replan-dialog review-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>执行复盘</h3>
        <p className="hint">
          {finished
            ? '模拟已结束：以下对照模拟开始时冻结的排程快照统计；快照不受模拟期间的图编辑与现场续排影响。'
            : `暂停于 t = ${round1(simTime)}s：当前为中间复盘，继续模拟后数据随之更新（开始时冻结的计划快照不变）。`}
        </p>

        <div className="review-summary">
          <div className="review-stat">
            <span className="review-stat-num">{doneCount}</span>
            <span className="review-stat-label">
              完成 / 共 {rows.length}
              {!finished && runningCount > 0 && (
                <em className="review-stat-sub">（执行中 {runningCount}）</em>
              )}
              {notRunCount > 0 && <em className="review-stat-sub">（未执行 {notRunCount}）</em>}
            </span>
          </div>
          <div className="review-stat">
            <span className={`review-stat-num ${maxDelay > EPS ? 'stat-warn' : ''}`}>
              {round1(maxDelay)}s
            </span>
            <span className="review-stat-label">
              最大延迟
              {delayedCount > 0 && <em className="review-stat-sub">（{delayedCount} 条延迟）</em>}
            </span>
          </div>
          <div className="review-stat">
            <span
              className={`review-stat-num ${
                makespanDelta > EPS ? 'stat-warn' : makespanDelta < -EPS ? 'stat-early' : ''
              }`}
            >
              <Delta value={makespanDelta} />
            </span>
            <span className="review-stat-label">
              总工期偏差
              <em className="review-stat-sub">
                （计划 {round1(snapshot.plannedMakespan)}s / 实际 {round1(actualMakespan)}s）
              </em>
            </span>
          </div>
        </div>

        <table className="replan-table review-table">
          <thead>
            <tr>
              <th>口令</th>
              <th>计划起止</th>
              <th>实际起止</th>
              <th>开始偏差</th>
              <th>结束偏差</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nodeId}>
                <td>{r.name}</td>
                <td>
                  {round1(r.plannedStart)}s → {round1(r.plannedEnd)}s
                </td>
                <td>
                  {r.actualStart === undefined
                    ? '—'
                    : `${round1(r.actualStart)}s → ${round1(r.actualEnd ?? r.actualStart)}s`}
                </td>
                <td>
                  {r.actualStart === undefined ? (
                    '—'
                  ) : (
                    <Delta value={r.actualStart - r.plannedStart} />
                  )}
                </td>
                <td>
                  {r.actualEnd === undefined ? (
                    '—'
                  ) : (
                    <Delta value={r.actualEnd - r.plannedEnd} />
                  )}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.actualStart !== undefined && !r.completed && (
                    <span className="review-status running">执行中</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="hint">
          复盘为只读视图，不写回项目；点击「重置」清空本次复盘与冻结快照。
        </p>
        <div className="replan-actions">
          <button className="primary" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === 'onTime') return <span className="review-status ok">按时</span>;
  if (status === 'delayed') return <span className="review-status delayed">延迟</span>;
  return <span className="review-status notrun">未执行</span>;
}

function Delta({ value }: { value: number }) {
  if (Math.abs(value) < EPS) return <span className="delta-zero">±0s</span>;
  return (
    <span className={value > 0 ? 'delta-up' : 'delta-down'}>
      {value > 0 ? '+' : '−'}
      {round1(Math.abs(value))}s
    </span>
  );
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
