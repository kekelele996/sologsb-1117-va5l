/** DropPoint 投放点 */
export interface DropPoint {
  id: string
  orchardId: string
  longitude: number
  latitude: number
  /** 编号，如 A-03 */
  code: string
  /** 可容纳箱数 */
  capacityBoxes: number
  /** 遮阴条件 */
  shade: string
  /** 水源距离（米） */
  waterDistance: number
  /** 投放时间窗（起） */
  dropWindow: string
  /** 撤场时间 */
  withdrawTime: string
  /** 责任人 */
  owner: string
  /** 该投放点安排的群号（用于冲突判定与占用折算） */
  colonyCodes: string[]
  /**
   * 托管队数据修订号：可容纳箱数变更时 +1。
   * 排程重算基准里记录的修订号与当前不一致 → 引用本点的排程失效待重算。
   */
  revision: number
}
