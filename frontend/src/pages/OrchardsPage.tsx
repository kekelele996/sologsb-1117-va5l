import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { DropPoint, Orchard } from '@/types'
import { ACCESSIBILITIES, CROPS, colonyBoxes, suggestColonyBoxes } from '@/types'
import CoordPicker from '@/components/common/CoordPicker'
import FlowerWindowBar from '@/components/common/FlowerWindowBar'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { droppointStore } from '@/stores/droppointStore'
import { colonyStore } from '@/stores/colonyStore'
import { routeStore } from '@/stores/routeStore'
import { scheduleStore } from '@/stores/scheduleStore'
import { bloomDays } from '@/utils/geo'
import { evaluateSchedule, staleDropPointIds } from '@/utils/schedule'
import { uid } from '@/utils/id'

interface OrchardFormValues {
  name: string
  crop: Orchard['crop']
  areaMu: number
  colonyIntensity: number
  ownerContact: string
  accessibility: Orchard['accessibility']
  historyYears: string
  note: string
  bloom: [dayjs.Dayjs, dayjs.Dayjs]
}

interface DropFormValues {
  code: string
  capacityBoxes: number
  shade: string
  waterDistance: number
  dropWindow: dayjs.Dayjs
  withdrawTime: dayjs.Dayjs
  owner: string
  colonyCodes: string[]
}

/** 果园地块管理：录入面积与花期后自动给出建议箱数与可达性标记，并维护投放点 */
export default function OrchardsPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const basis = usePersistentStore(scheduleStore, (state) => state.basis)

  const [orchardModal, setOrchardModal] = useState(false)
  const [editingOrchard, setEditingOrchard] = useState<Orchard | null>(null)
  const [coord, setCoord] = useState({ longitude: 107.41, latitude: 34.61 })
  const [orchardForm] = Form.useForm<OrchardFormValues>()

  const [dropModal, setDropModal] = useState(false)
  const [dropOwner, setDropOwner] = useState<Orchard | null>(null)
  const [editingDrop, setEditingDrop] = useState<DropPoint | null>(null)
  const [dropCoord, setDropCoord] = useState({ longitude: 107.41, latitude: 34.61 })
  const [dropForm] = Form.useForm<DropFormValues>()

  const watchedArea = Form.useWatch('areaMu', orchardForm) ?? 0
  const watchedIntensity = Form.useWatch('colonyIntensity', orchardForm) ?? 0
  const suggestPreview = suggestColonyBoxes({
    areaMu: Number(watchedArea) || 0,
    colonyIntensity: Number(watchedIntensity) || 0
  })

  /** 投放点弹窗内实时校核：已选群按箱型折算 vs 容量 */
  const watchedCodes: string[] = Form.useWatch('colonyCodes', dropForm) ?? []
  const watchedCapacity = Number(Form.useWatch('capacityBoxes', dropForm) ?? 0) || 0
  const selectedBoxes = useMemo(
    () =>
      Math.round(
        watchedCodes.reduce((sum, code) => {
          const colony = colonies.find((item) => item.code === code)
          return sum + (colony ? colonyBoxes(colony) : 0)
        }, 0) * 100
      ) / 100,
    [watchedCodes, colonies]
  )
  const overBoxes = Math.round((selectedBoxes - watchedCapacity) * 100) / 100
  const capacityChanged = editingDrop !== null && watchedCapacity !== editingDrop.capacityBoxes

  /** 占用评估与失效标记（按两边最新数据实时推导） */
  const evals = useMemo(() => evaluateSchedule(dropPoints, colonies, routes), [dropPoints, colonies, routes])
  const staleIds = useMemo(() => staleDropPointIds(orchards, dropPoints, basis), [orchards, dropPoints, basis])

  const dropsOf = useMemo(
    () => (orchardId: string): DropPoint[] => dropPoints.filter((item) => item.orchardId === orchardId),
    [dropPoints]
  )

  function openCreate(): void {
    setEditingOrchard(null)
    setCoord({ longitude: 107.41, latitude: 34.61 })
    orchardForm.setFieldsValue({
      name: '',
      crop: '苹果',
      areaMu: 100,
      colonyIntensity: 0.1,
      ownerContact: '',
      accessibility: '大车可达',
      historyYears: '2025',
      note: '',
      bloom: [dayjs().month(3).date(8), dayjs().month(3).date(18)]
    })
    setOrchardModal(true)
  }

  function openEdit(orchard: Orchard): void {
    setEditingOrchard(orchard)
    setCoord({ longitude: orchard.longitude, latitude: orchard.latitude })
    orchardForm.setFieldsValue({
      name: orchard.name,
      crop: orchard.crop,
      areaMu: orchard.areaMu,
      colonyIntensity: orchard.colonyIntensity,
      ownerContact: orchard.ownerContact,
      accessibility: orchard.accessibility,
      historyYears: orchard.historyYears.join('、'),
      note: orchard.note,
      bloom: [dayjs(orchard.bloomStart), dayjs(orchard.bloomEnd)]
    })
    setOrchardModal(true)
  }

  async function submitOrchard(): Promise<void> {
    const values = await orchardForm.validateFields()
    const accessibilityChanged = editingOrchard !== null && values.accessibility !== editingOrchard.accessibility
    const row: Orchard = {
      id: editingOrchard?.id ?? uid('orc'),
      name: values.name.trim(),
      crop: values.crop,
      areaMu: Number(values.areaMu) || 0,
      longitude: coord.longitude,
      latitude: coord.latitude,
      bloomStart: values.bloom[0].format('YYYY-MM-DD'),
      bloomEnd: values.bloom[1].format('YYYY-MM-DD'),
      colonyIntensity: Number(values.colonyIntensity) || 0,
      ownerContact: values.ownerContact.trim(),
      accessibility: values.accessibility,
      historyYears: values.historyYears
        .split(/[、,，\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0),
      note: values.note?.trim() ?? '',
      revision: editingOrchard?.revision ?? 1
    }
    await orchardStore.getState().save(row)
    message.success(
      accessibilityChanged
        ? `地块「${row.name}」已保存；可达性变更，引用它的排程已失效，请在总表重算后再导出`
        : `地块「${row.name}」已保存，建议蜂群 ${suggestColonyBoxes(row)} 箱`
    )
    setOrchardModal(false)
  }

  async function removeOrchard(orchard: Orchard): Promise<void> {
    const drops = dropsOf(orchard.id)
    if (drops.length > 0) {
      message.error(`「${orchard.name}」下仍有 ${drops.length} 个投放点，请先清理投放点`)
      return
    }
    await orchardStore.getState().remove(orchard.id)
    message.success('地块已删除')
  }

  function openDrop(orchard: Orchard): void {
    setDropOwner(orchard)
    setEditingDrop(null)
    setDropCoord({ longitude: orchard.longitude, latitude: orchard.latitude })
    const index = dropPoints.filter((item) => item.orchardId === orchard.id).length + 1
    dropForm.setFieldsValue({
      code: `${orchard.crop.slice(0, 1)}-${String(index).padStart(2, '0')}`,
      capacityBoxes: suggestColonyBoxes(orchard),
      shade: '',
      waterDistance: 300,
      dropWindow: dayjs(orchard.bloomStart).subtract(1, 'day'),
      withdrawTime: dayjs(orchard.bloomEnd).add(1, 'day'),
      owner: '',
      colonyCodes: []
    })
    setDropModal(true)
  }

  function openEditDrop(point: DropPoint): void {
    const orchard = orchards.find((item) => item.id === point.orchardId) ?? null
    setDropOwner(orchard)
    setEditingDrop(point)
    setDropCoord({ longitude: point.longitude, latitude: point.latitude })
    dropForm.setFieldsValue({
      code: point.code,
      capacityBoxes: point.capacityBoxes,
      shade: point.shade,
      waterDistance: point.waterDistance,
      dropWindow: dayjs(point.dropWindow),
      withdrawTime: dayjs(point.withdrawTime),
      owner: point.owner,
      colonyCodes: [...point.colonyCodes]
    })
    setDropModal(true)
  }

  async function submitDrop(): Promise<void> {
    if (!dropOwner) return
    const values = await dropForm.validateFields()
    const capacityWillChange = editingDrop !== null && (Number(values.capacityBoxes) || 0) !== editingDrop.capacityBoxes
    const row: DropPoint = {
      id: editingDrop?.id ?? uid('dp'),
      orchardId: dropOwner.id,
      longitude: dropCoord.longitude,
      latitude: dropCoord.latitude,
      code: values.code.trim(),
      capacityBoxes: Number(values.capacityBoxes) || 0,
      shade: values.shade?.trim() ?? '',
      waterDistance: Number(values.waterDistance) || 0,
      dropWindow: values.dropWindow.format('YYYY-MM-DD'),
      withdrawTime: values.withdrawTime.format('YYYY-MM-DD'),
      owner: values.owner?.trim() ?? '',
      colonyCodes: values.colonyCodes ?? [],
      revision: editingDrop?.revision ?? 1
    }
    await droppointStore.getState().save(row)
    if (capacityWillChange) {
      message.warning(`投放点 ${row.code} 已保存；容量变更，引用本点的排程已失效，请在总表重算后再导出`)
    } else if (overBoxes > 0) {
      message.warning(`投放点 ${row.code} 已保存；已选折合 ${selectedBoxes} 箱超容，${overBoxes} 箱将按容量排队`)
    } else {
      message.success(`投放点 ${row.code} 已保存`)
    }
    setDropModal(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">果园地块管理</h2>
          <p className="page-sub">
            录入面积与需蜂强度后自动算出建议箱数；可达性以标签标记。每个地块可维护多个蜂群投放点（含可容纳箱数与时间窗）。修改可达性或容量会使引用它的排程失效，需重算后才可导出。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建地块
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {orchards.map((orchard) => (
          <Col key={orchard.id} xs={24} xl={12}>
            <Card
              size="small"
              title={
                <Space wrap>
                  <span>{orchard.name}</span>
                  <Tag color="blue">{orchard.crop}</Tag>
                  <Tag color={orchard.accessibility === '大车可达' ? 'green' : orchard.accessibility === '仅小车' ? 'gold' : 'red'}>
                    {orchard.accessibility}
                  </Tag>
                  <Tag color="orange">建议 {suggestColonyBoxes(orchard)} 箱</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" onClick={() => openEdit(orchard)}>
                    编辑
                  </Button>
                  <Button size="small" onClick={() => openDrop(orchard)}>
                    新增投放点
                  </Button>
                  <Button size="small" danger onClick={() => void removeOrchard(orchard)}>
                    删除
                  </Button>
                </Space>
              }
            >
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                {orchard.areaMu} 亩 · 需蜂 {orchard.colonyIntensity} 箱/亩 · 园主 {orchard.ownerContact || '—'} · 历史授粉{' '}
                {orchard.historyYears.length > 0 ? orchard.historyYears.join('、') : '—'} 年 · 花期 {bloomDays(orchard)} 天
              </Typography.Paragraph>
              <FlowerWindowBar orchard={orchard} others={orchards.filter((item) => item.id !== orchard.id)} width={420} />
              <Table<DropPoint>
                style={{ marginTop: 10 }}
                size="small"
                pagination={false}
                dataSource={dropsOf(orchard.id)}
                rowKey="id"
                locale={{ emptyText: '暂无投放点' }}
                columns={[
                  { title: '编号', dataIndex: 'code', key: 'code', width: 70 },
                  { title: '投放窗', dataIndex: 'dropWindow', key: 'win', width: 105 },
                  { title: '撤场', dataIndex: 'withdrawTime', key: 'with', width: 105 },
                  {
                    title: '占用（折合箱）',
                    key: 'occupancy',
                    width: 110,
                    render: (_, record: DropPoint) => {
                      const eval_ = evals.get(record.id)
                      if (!eval_) return `${record.capacityBoxes} 箱`
                      const over = eval_.occupancyBoxes > eval_.capacity
                      return (
                        <Typography.Text type={over ? 'danger' : undefined}>
                          {eval_.occupancyBoxes} / {eval_.capacity} 箱
                        </Typography.Text>
                      )
                    }
                  },
                  {
                    title: '安排群号',
                    key: 'codes',
                    render: (_, record: DropPoint) => {
                      const eval_ = evals.get(record.id)
                      if (!eval_ || eval_.assignments.length === 0) return '—'
                      return (
                        <Space wrap size={4}>
                          {eval_.assignments.map((item) =>
                            item.known ? (
                              <Tag key={item.code} color={item.queued ? 'orange' : 'cyan'}>
                                {item.code}（{item.boxes} 箱）{item.queued ? '·排队' : ''}
                              </Tag>
                            ) : (
                              <Tag key={item.code} color="red">
                                {item.code}（未知）
                              </Tag>
                            )
                          )}
                        </Space>
                      )
                    }
                  },
                  {
                    title: '状态',
                    key: 'status',
                    width: 170,
                    render: (_, record: DropPoint) => {
                      const eval_ = evals.get(record.id)
                      return (
                        <Space wrap size={4}>
                          {staleIds.has(record.id) ? <Tag color="red">待重算</Tag> : null}
                          {eval_ && eval_.queuedCount > 0 ? (
                            <Tooltip title="装不下的群按容量排队">
                              <Tag color="orange">差 {eval_.deficitBoxes} 箱</Tag>
                            </Tooltip>
                          ) : null}
                          {eval_?.windowIssue ? (
                            <Tooltip title={`转场预计 ${eval_.windowIssue.arrival} 到达，晚于投放窗`}>
                              <Tag color="gold">需调窗口</Tag>
                            </Tooltip>
                          ) : null}
                        </Space>
                      )
                    }
                  },
                  {
                    title: '操作',
                    key: 'action',
                    width: 110,
                    render: (_, record: DropPoint) => (
                      <Space size={0}>
                        <Button size="small" type="link" onClick={() => openEditDrop(record)}>
                          编辑
                        </Button>
                        <Button size="small" danger type="link" onClick={() => void droppointStore.getState().remove(record.id)}>
                          删除
                        </Button>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Modal title={editingOrchard ? '编辑地块' : '新建地块'} open={orchardModal} onCancel={() => setOrchardModal(false)} onOk={() => void submitOrchard()} width={720} okText="保存">
        <Form form={orchardForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="地块名" rules={[{ required: true, message: '请填写地块名' }]}>
                <Input placeholder="如 北岭苹果园" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="crop" label="作物" rules={[{ required: true }]}>
                <Select options={CROPS.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="areaMu" label="面积（亩）" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="colonyIntensity" label="需蜂强度（箱/亩）" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="accessibility" label="道路可达性" rules={[{ required: true }]} extra="变更后引用本地块的排程失效待重算">
                <Select options={ACCESSIBILITIES.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ownerContact" label="园主联系方式">
                <Input placeholder="如 135****2043（周园主）" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="bloom" label="盛花期区间" rules={[{ required: true, message: '请选择盛花期区间' }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="historyYears" label="历史授粉年份（顿号分隔）">
                <Input placeholder="如 2024、2025" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="note" label="备注">
                <Input placeholder="行距、坡向等" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="经纬度">
            <CoordPicker value={coord} onChange={setCoord} orchards={orchards} dropPoints={dropPoints} />
          </Form.Item>
          <OrchardSuggest suggest={suggestPreview} />
        </Form>
      </Modal>

      <Modal
        title={`${editingDrop ? '编辑' : '新增'}投放点 · ${dropOwner?.name ?? ''}`}
        open={dropModal}
        onCancel={() => setDropModal(false)}
        onOk={() => void submitDrop()}
        width={720}
        okText="保存"
      >
        <Form form={dropForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="编号" rules={[{ required: true, message: '请填写投放点编号' }]}>
                <Input placeholder="如 A-03" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="capacityBoxes"
                label="可容纳箱数"
                rules={[{ required: true }]}
                extra={capacityChanged ? '容量变更后引用本点的排程失效待重算' : undefined}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="waterDistance" label="水源距离（米）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dropWindow" label="投放时间窗" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="withdrawTime" label="撤场时间" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="owner" label="责任人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shade" label="遮阴条件">
                <Input placeholder="如 北侧有防风林，午后半阴" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="colonyCodes" label="安排群号（同一群跨地块重叠即冲突）">
                <Select mode="multiple" options={colonies.map((item) => ({ value: item.code, label: `${item.code}（${item.species} ${item.strengthFrames} 足框 · ${item.boxType} 折 ${colonyBoxes(item)} 箱）` }))} />
              </Form.Item>
              <Typography.Text type={overBoxes > 0 ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                已选折合 {selectedBoxes} 箱 / 容量 {watchedCapacity} 箱
                {overBoxes > 0 ? `，超出 ${overBoxes} 箱，保存后超出的群将按容量排队` : ''}
              </Typography.Text>
            </Col>
          </Row>
          <Form.Item label="经纬度">
            <CoordPicker value={dropCoord} onChange={setDropCoord} orchards={orchards} dropPoints={dropPoints} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** 建议箱数提示条（面积 × 需蜂强度向上取整，最少 1 箱） */
function OrchardSuggest({ suggest }: { suggest: number }): JSX.Element {
  return (
    <Typography.Text type="secondary">
      系统建议投放 {suggest} 箱；按每个投放点 8 箱估算，约需 {Math.max(1, Math.ceil(suggest / 8))} 个投放点。
    </Typography.Text>
  )
}
