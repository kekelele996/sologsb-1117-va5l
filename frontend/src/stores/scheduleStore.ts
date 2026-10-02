import { create } from 'zustand'
import type { BeeColony, DropPoint, Orchard } from '@/types'
import { db, loadAll, loadMetaString, saveMetaString, SCHEDULE_META_KEY } from '@/hooks/usePersistentStore'
import { planDropPoint, type DropPointPlan } from '@/utils/schedule'

/** 排程失效原因（托管队改可达性/容量，或技术员改箱型后积累） */
export interface StaleReason {
  kind: 'orchard-accessibility' | 'droppoint-capacity' | 'colony-boxtype' | 'migration'
  refId: string
  label: string
  at: string
}

interface PersistedSchedule {
  valid: boolean
  staleReasons: StaleReason[]
  lastRecalcAt: string | null
}

export interface ScheduleIssue {
  dropPoint: DropPoint
  plan: DropPointPlan
}

export interface ScheduleState extends PersistedSchedule {
  loaded: boolean
  hydrate: () => Promise<void>
  /** 托管队改了地块可达性 / 投放点容量 → 排程失效 */
  notifyHostingChange: (reason: { kind: StaleReason['kind']; refId: string; label: string }) => void
  /** 技术员改了蜂群箱型 → 排程失效 */
  notifyTechnicianChange: (reason: { kind: StaleReason['kind']; refId: string; label: string }) => void
  /** 按托管队与技术员最新一版数据重算，返回仍存在容量/窗口问题的投放点 */
  recalculate: () => Promise<{ issues: ScheduleIssue[] }>
}

async function persist(state: PersistedSchedule): Promise<void> {
  await saveMetaString(SCHEDULE_META_KEY, JSON.stringify(state))
}

function applyChange(
  set: (partial: Partial<ScheduleState>) => void,
  get: () => ScheduleState,
  reason: { kind: StaleReason['kind']; refId: string; label: string }
): void {
  const state = get()
  const staleReasons = [
    ...state.staleReasons.filter((item) => !(item.kind === reason.kind && item.refId === reason.refId)),
    { ...reason, at: new Date().toISOString() }
  ]
  const next: PersistedSchedule = { valid: false, staleReasons, lastRecalcAt: state.lastRecalcAt }
  set({ ...next })
  void persist(next)
}

/** 排程有效性：托管队改可达性/容量后失效，技术员重算后恢复；重算完前禁止导出为可执行方案 */
export const scheduleStore = create<ScheduleState>((set, get) => ({
  valid: true,
  staleReasons: [],
  lastRecalcAt: null,
  loaded: false,
  hydrate: async () => {
    const raw = await loadMetaString(SCHEDULE_META_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedSchedule>
        set({
          valid: parsed.valid !== false,
          staleReasons: Array.isArray(parsed.staleReasons) ? parsed.staleReasons : [],
          lastRecalcAt: parsed.lastRecalcAt ?? null,
          loaded: true
        })
        return
      } catch {
        // 解析失败按默认值处理
      }
    }
    set({ loaded: true })
  },
  notifyHostingChange: (reason) => applyChange(set, get, reason),
  notifyTechnicianChange: (reason) => applyChange(set, get, reason),
  recalculate: async () => {
    const [dropPoints, colonies, orchards] = await Promise.all([
      loadAll<DropPoint>(db.dropPoints),
      loadAll<BeeColony>(db.colonies),
      loadAll<Orchard>(db.orchards)
    ])
    const issues: ScheduleIssue[] = []
    for (const point of dropPoints) {
      const plan = planDropPoint(point, colonies, orchards)
      if (plan.shortfallBoxes > 0 || plan.windowIssues.length > 0) {
        issues.push({ dropPoint: point, plan })
      }
    }
    const next: PersistedSchedule = { valid: true, staleReasons: [], lastRecalcAt: new Date().toISOString() }
    set({ ...next })
    await persist(next)
    return { issues }
  }
}))
