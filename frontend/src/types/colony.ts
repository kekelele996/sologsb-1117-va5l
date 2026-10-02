/** 蜂种 */
export const BEE_SPECIES = ['意蜂', '中蜂'] as const
export type BeeSpecies = (typeof BEE_SPECIES)[number]

/** 蜂群状态 */
export const COLONY_STATUSES = ['待投放', '在园', '转场中', '回场'] as const
export type ColonyStatus = (typeof COLONY_STATUSES)[number]

/** 箱型 */
export const BOX_TYPES = ['标准继箱', '平箱', '交尾箱'] as const
export type BoxType = (typeof BOX_TYPES)[number]

/** 旧数据缺箱型时的默认补齐值 */
export const DEFAULT_BOX_TYPE: BoxType = '标准继箱'

/** 箱型折算箱数：投放点容量校核时按此把一群蜂折成占用箱数 */
export const BOX_UNITS: Record<BoxType, number> = {
  标准继箱: 2,
  平箱: 1,
  交尾箱: 0.5
}

/** BeeColony 蜂群 */
export interface BeeColony {
  id: string
  /** 群号 */
  code: string
  species: BeeSpecies
  /** 群势（足框数） */
  strengthFrames: number
  boxType: BoxType
  /** 当前所在地块 */
  currentOrchardId: string
  status: ColonyStatus
  /** 最近检查日期 */
  lastCheckDate: string
  /** 蜂群健康备注 */
  healthNote: string
}

/** 按箱型把一群蜂折算成占用箱数；缺箱型（旧数据）按默认箱型兜底 */
export function colonyBoxes(colony: Pick<BeeColony, 'boxType'>): number {
  return BOX_UNITS[colony.boxType] ?? BOX_UNITS[DEFAULT_BOX_TYPE]
}
