import type { BeeColony, DropPoint, Orchard, TransitRoute } from '@/types'
import { colonyBoxes } from '@/types'

/** 旧数据缺容量时的默认补齐值（与 v2/v3 迁移一致） */
export const DEFAULT_DROP_CAPACITY = 8

/** 投放点容量（缺省按默认补齐） */
export function capacityOf(point: Pick<DropPoint, 'capacityBoxes'>): number {
  return point.capacityBoxes > 0 ? point.capacityBoxes : DEFAULT_DROP_CAPACITY
}

/** 单群占用评估 */
export interface AssignmentEval {
  code: string
  /** 群号是否能在蜂群台账（技术员侧最新数据）中查到 */
  known: boolean
  /** 按箱型折算的占用箱数（未知群号计 0） */
  boxes: number
  /** 是否因容量不足在排队 */
  queued: boolean
}

/** 投放窗问题：转场预计到达晚于投放窗，需托管队调整窗口 */
export interface WindowIssue {
  /** 预计到达（ISO 本地时间文本） */
  arrival: string
  /** 投放窗日期 */
  window: string
}

/** 单个投放点的占用评估（全部由两边最新数据实时推导，不落库） */
export interface DropPointEval {
  pointId: string
  orchardId: string
  capacity: number
  /** 已安排群号按箱型折算的占用箱数合计 */
  occupancyBoxes: number
  assignments: AssignmentEval[]
  /** 排队群数（装不下按容量排队） */
  queuedCount: number
  /** 容量缺口：差几箱才能装下全部排队群 */
  deficitBoxes: number
  /** 台账里查不到的群号（两边数据对不上，需人工核对） */
  unknownCodes: string[]
  windowIssue: WindowIssue | null
}

/** 到达时刻：转场路线 departAt + durationH；返回该点最晚一次到达 */
export function latestArrivalAt(pointId: string, routes: TransitRoute[]): Date | null {
  let best: number | null = null
  routes.forEach((route) => {
    if (route.toDropId !== pointId) return
    const depart = new Date(route.departAt)
    if (Number.isNaN(depart.getTime())) return
    const arrival = depart.getTime() + (route.durationH || 0) * 3600_000
    if (best === null || arrival > best) best = arrival
  })
  return best === null ? null : new Date(best)
}

/** 投放窗校核：最晚到达晚于投放窗当天结束 → 需托管队调窗口 */
export function checkDropWindow(point: DropPoint, routes: TransitRoute[]): WindowIssue | null {
  if (!point.dropWindow) return null
  const arrival = latestArrivalAt(point.id, routes)
  if (!arrival) return null
  const windowEnd = new Date(`${point.dropWindow}T23:59:59`)
  if (Number.isNaN(windowEnd.getTime()) || arrival.getTime() <= windowEnd.getTime()) return null
  const pad = (value: number): string => String(value).padStart(2, '0')
  const text = `${arrival.getFullYear()}-${pad(arrival.getMonth() + 1)}-${pad(arrival.getDate())} ${pad(arrival.getHours())}:${pad(arrival.getMinutes())}`
  return { arrival: text, window: point.dropWindow }
}

/**
 * 评估单个投放点：占用按托管队（投放点）与技术员（蜂群台账）两边最新数据实时折算。
 * 按安排顺序累计折算箱数，超出容量的群依次排队，并给出容量缺口（差几箱）。
 */
export function evaluateDropPoint(point: DropPoint, colonies: BeeColony[], routes: TransitRoute[]): DropPointEval {
  const capacity = capacityOf(point)
  const byCode = new Map(colonies.map((colony) => [colony.code, colony]))
  const assignments: AssignmentEval[] = []
  const unknownCodes: string[] = []
  let used = 0
  let occupancy = 0
  point.colonyCodes.forEach((code) => {
    const colony = byCode.get(code)
    if (!colony) {
      unknownCodes.push(code)
      assignments.push({ code, known: false, boxes: 0, queued: false })
      return
    }
    const boxes = colonyBoxes(colony)
    occupancy += boxes
    const queued = used + boxes > capacity
    if (!queued) used += boxes
    assignments.push({ code, known: true, boxes, queued })
  })
  const queuedCount = assignments.filter((item) => item.queued).length
  const deficitBoxes = Math.max(0, Math.round((occupancy - capacity) * 100) / 100)
  return {
    pointId: point.id,
    orchardId: point.orchardId,
    capacity,
    occupancyBoxes: Math.round(occupancy * 100) / 100,
    assignments,
    queuedCount,
    deficitBoxes,
    unknownCodes,
    windowIssue: checkDropWindow(point, routes)
  }
}

/** 全量评估：投放点 id → 评估结果 */
export function evaluateSchedule(
  dropPoints: DropPoint[],
  colonies: BeeColony[],
  routes: TransitRoute[]
): Map<string, DropPointEval> {
  const result = new Map<string, DropPointEval>()
  dropPoints.forEach((point) => {
    result.set(point.id, evaluateDropPoint(point, colonies, routes))
  })
  return result
}

/**
 * 排程重算基准：上次重算时托管队数据（地块可达性 / 投放点容量）的修订号快照。
 * 托管队改动后修订号与基准不一致 → 引用它的排程失效，重算前不得作为可执行方案导出。
 */
export interface ScheduleBasis {
  computedAt: string
  orchardRevisions: Record<string, number>
  dropRevisions: Record<string, number>
}

/** 按当前托管队数据生成基准快照 */
export function snapshotBasis(orchards: Orchard[], dropPoints: DropPoint[], computedAt = new Date().toISOString()): ScheduleBasis {
  const orchardRevisions: Record<string, number> = {}
  orchards.forEach((orchard) => {
    orchardRevisions[orchard.id] = orchard.revision ?? 1
  })
  const dropRevisions: Record<string, number> = {}
  dropPoints.forEach((point) => {
    dropRevisions[point.id] = point.revision ?? 1
  })
  return { computedAt, orchardRevisions, dropRevisions }
}

/**
 * 找出失效（待重算）的投放点排程：
 * 点自身容量修订号或所属地块可达性修订号与基准不一致，且该点排有蜂群（存在引用它的排程）。
 * 基准之后新建的点位不算失效（下一次重算会纳入基准）。
 */
export function staleDropPointIds(orchards: Orchard[], dropPoints: DropPoint[], basis: ScheduleBasis | null): Set<string> {
  const stale = new Set<string>()
  if (!basis) return stale
  const orchardById = new Map(orchards.map((orchard) => [orchard.id, orchard]))
  dropPoints.forEach((point) => {
    if (point.colonyCodes.length === 0) return
    const baseDrop = basis.dropRevisions[point.id]
    if (baseDrop !== undefined && baseDrop !== (point.revision ?? 1)) {
      stale.add(point.id)
      return
    }
    const orchard = orchardById.get(point.orchardId)
    if (!orchard) return
    const baseOrchard = basis.orchardRevisions[orchard.id]
    if (baseOrchard !== undefined && baseOrchard !== (orchard.revision ?? 1)) {
      stale.add(point.id)
    }
  })
  return stale
}

/** 排程行的可执行状态标签（导出清单与总表共用） */
export function scheduleRowStatus(eval_: DropPointEval | undefined, stale: boolean): string {
  const parts: string[] = []
  if (stale) parts.push('待重算')
  if (eval_ && eval_.queuedCount > 0) parts.push(`排队 ${eval_.queuedCount} 群·差 ${eval_.deficitBoxes} 箱`)
  if (eval_?.windowIssue) parts.push('需托管队调窗口')
  if (eval_ && eval_.unknownCodes.length > 0) parts.push('群号待核对')
  return parts.length > 0 ? parts.join('；') : '正常'
}
