/** 作物类型 */
export const CROPS = ['苹果', '梨', '樱桃', '蓝莓', '油菜'] as const
export type Crop = (typeof CROPS)[number]

/** 道路可达性 */
export const ACCESSIBILITIES = ['大车可达', '仅小车', '需步行'] as const
export type Accessibility = (typeof ACCESSIBILITIES)[number]

/** Orchard 果园地块 */
export interface Orchard {
  id: string
  /** 地块名 */
  name: string
  crop: Crop
  /** 面积（亩） */
  areaMu: number
  longitude: number
  latitude: number
  /** 盛花期起 */
  bloomStart: string
  /** 盛花期止 */
  bloomEnd: string
  /** 需蜂群强度（箱/亩） */
  colonyIntensity: number
  /** 园主联系方式 */
  ownerContact: string
  accessibility: Accessibility
  /** 历史授粉年份 */
  historyYears: number[]
  note: string
  /**
   * 托管队数据修订号：可达性变更时 +1。
   * 排程重算基准里记录的修订号与当前不一致 → 引用本地块的排程失效待重算。
   */
  revision: number
}

/** 由面积与需蜂强度算出建议箱数（向上取整，最少 1 箱） */
export function suggestColonyBoxes(orchard: Pick<Orchard, 'areaMu' | 'colonyIntensity'>): number {
  const boxes = Math.ceil((orchard.areaMu || 0) * (orchard.colonyIntensity || 0))
  return boxes > 0 ? boxes : 1
}
