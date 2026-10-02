import type { BeeColony, BoxType, DropPoint, Orchard } from '@/types'

/**
 * 箱型折箱系数：该箱型的蜂群在投放点占用的「标准箱位」数。
 * 标准继箱 / 平箱各占 1 个箱位；交尾箱体型小，2 群合占 1 个箱位（0.5）。
 */
export const BOX_TYPE_FACTOR: Record<BoxType, number> = {
  标准继箱: 1,
  平箱: 1,
  交尾箱: 0.5
}

/** 一群按箱型折出的箱位数（缺省按 1 箱兜底） */
export function colonyBoxes(colony: Pick<BeeColony, 'boxType'>): number {
  const factor = BOX_TYPE_FACTOR[colony.boxType]
  return typeof factor === 'number' && factor > 0 ? factor : 1
}

/** 投放点容量缺省值（旧数据升级或缺容量时按此补齐） */
export const DEFAULT_CAPACITY_BOXES = 8

/** 取投放点容量，缺失或非正数时按默认 8 箱兜底 */
export function capacityOf(point: Pick<DropPoint, 'capacityBoxes'>): number {
  return point.capacityBoxes > 0 ? point.capacityBoxes : DEFAULT_CAPACITY_BOXES
}

export interface QueuedColony {
  colony: BeeColony
  /** 该群折出的箱位数 */
  boxes: number
}

export interface WindowIssue {
  colony: BeeColony
  /** 赶不上投放窗的原因（提示托管队先调窗口） */
  reason: string
}

export interface DropPointPlan {
  dropPoint: DropPoint
  /** 按容量排入的蜂群 */
  assigned: QueuedColony[]
  /** 装不下、按顺序排队的蜂群 */
  queued: QueuedColony[]
  /** 已排入箱数 */
  usedBoxes: number
  /** 全部候选群折箱合计（需求箱数） */
  demandBoxes: number
  /** 投放点容量（箱） */
  capacityBoxes: number
  /** 差几箱（整数箱，向上取整；0 表示装得下） */
  shortfallBoxes: number
  /** 赶不上投放窗的蜂群及原因 */
  windowIssues: WindowIssue[]
}

/** 判断蜂群能否在投放窗开始前进场；赶不上则给出「请托管队先调窗口」的提示 */
function checkWindow(colony: BeeColony, dropPoint: DropPoint, orchards: Orchard[]): WindowIssue | null {
  if (colony.status === '回场') {
    return {
      colony,
      reason: `蜂群 ${colony.code} 已回场，赶不上 ${dropPoint.dropWindow} 的投放窗，请让托管队先调整投放窗口。`
    }
  }
  if (colony.status === '在园' && colony.currentOrchardId) {
    // 已在投放点所在地块 → 可直接进场
    if (colony.currentOrchardId === dropPoint.orchardId) return null
    const current = orchards.find((item) => item.id === colony.currentOrchardId)
    if (current && current.bloomEnd > dropPoint.dropWindow) {
      return {
        colony,
        reason: `蜂群 ${colony.code} 仍在「${current.name}」盛花期内（至 ${current.bloomEnd}），赶不上 ${dropPoint.dropWindow} 的投放窗，请让托管队先调整投放窗口。`
      }
    }
  }
  return null
}

/**
 * 排群进投放点：按箱型折箱，容量内的排入，超出的按群号顺序排队并写明差几箱；
 * 赶不上投放窗的蜂群单独列出（需托管队先调窗口）。
 */
export function planDropPoint(
  dropPoint: DropPoint,
  colonies: BeeColony[],
  orchards: Orchard[]
): DropPointPlan {
  const capacityBoxes = capacityOf(dropPoint)
  const candidates = dropPoint.colonyCodes
    .map((code) => colonies.find((item) => item.code === code))
    .filter((item): item is BeeColony => Boolean(item))
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))

  const assigned: QueuedColony[] = []
  const queued: QueuedColony[] = []
  const windowIssues: WindowIssue[] = []
  let usedBoxes = 0

  for (const colony of candidates) {
    const boxes = colonyBoxes(colony)
    const issue = checkWindow(colony, dropPoint, orchards)
    if (issue) windowIssues.push(issue)
    if (usedBoxes + boxes <= capacityBoxes) {
      assigned.push({ colony, boxes })
      usedBoxes += boxes
    } else {
      queued.push({ colony, boxes })
    }
  }

  const demandBoxes = usedBoxes + queued.reduce((sum, item) => sum + item.boxes, 0)
  const shortfallBoxes = Math.max(0, Math.ceil(demandBoxes) - capacityBoxes)

  return {
    dropPoint,
    assigned,
    queued,
    usedBoxes,
    demandBoxes,
    capacityBoxes,
    shortfallBoxes,
    windowIssues
  }
}

/** 批量排群：返回所有投放点的方案 */
export function planAllDropPoints(
  dropPoints: DropPoint[],
  colonies: BeeColony[],
  orchards: Orchard[]
): DropPointPlan[] {
  return dropPoints.map((point) => planDropPoint(point, colonies, orchards))
}
