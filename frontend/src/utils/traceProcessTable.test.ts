import { describe, expect, it } from 'vitest'
import { traceProcessRows, traceProcessExportSource } from './traceProcessTable'
import type { MaterialTrace } from '@/types/materialTrace'

describe('process statistics', () => {
  it('keeps repeated team steps separate and does not count processing output as a second receipt', async () => {
    const trace = {
      serial_no: '0001',
      process_routes: [
        {
          id: 1,
          route_kind: 'normal',
          steps: [
            {
              sequence_no: 0,
              name: '退火一',
              team_name: '退火',
              planned_quantity: '10',
              serial_nos: [],
            },
            {
              sequence_no: 1,
              name: '退火二',
              team_name: '退火',
              planned_quantity: '10',
              serial_nos: [],
            },
          ],
        },
      ],
      items: [
        {
          id: 1,
          batch_no: 'A',
          status: 'received',
          entry_kind: 'transfer',
          quantity: 10,
          weight: 2,
          next_team: { id: 2, name: '退火' },
          process_route: { id: 1, step_index: 0 },
          on_hand_quantity: 0,
          on_hand_weight: 0,
        },
        {
          id: 2,
          batch_no: 'B',
          source_transfer_id: 1,
          status: 'received',
          entry_kind: 'processing_output',
          quantity: 20,
          weight: 2,
          next_team: { id: 2, name: '退火' },
          process_route: { id: 1, step_index: 0 },
          on_hand_quantity: 15,
          on_hand_weight: 1.5,
        },
        {
          id: 3,
          batch_no: 'C',
          source_transfer_id: 2,
          status: 'pending',
          entry_kind: 'transfer',
          quantity: 5,
          weight: 0.5,
        },
        {
          id: 4,
          batch_no: 'VOID',
          source_transfer_id: 2,
          status: 'voided',
          entry_kind: 'transfer',
          quantity: 9,
          weight: 0.9,
        },
      ],
      processing_records: [{ source_transfer_id: 1, completed_quantity: 20, completed_weight: 2 }],
    } as unknown as MaterialTrace
    const rows = traceProcessRows(trace)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      received: 10,
      completed: 20,
      sent: 5,
      stock: 15,
      stockWeight: 1.5,
    })
    expect(rows[1]).toMatchObject({ received: 0, completed: null, sent: 0 })
    const exported = await traceProcessExportSource(trace).load(
      new AbortController().signal,
      () => {},
    )
    expect(exported[0]?.serial).toBe('0001')
    expect(exported[0]?.completed).toBe(20)
  })
  it('keeps untracked balances unknown and excludes context ancestors', () => {
    const trace = {
      items: [
        {
          id: 1,
          status: 'received',
          quantity: 10,
          weight: 2,
          next_team: { id: 2, name: '研磨' },
          on_hand_quantity: null,
          on_hand_weight: null,
        },
        {
          id: 2,
          context_only: true,
          status: 'received',
          quantity: 99,
          weight: 99,
          next_team: { id: 3, name: '库房' },
        },
      ],
    } as MaterialTrace
    expect(traceProcessRows(trace)).toMatchObject([
      { received: 10, stock: null, stockWeight: null },
    ])
  })
  it('keeps historical receipt and work on their steps when a lot advances within the same team', () => {
    const trace = {
      process_routes: [
        {
          id: 1,
          route_kind: 'normal',
          steps: [
            {
              sequence_no: 1,
              name: '粗磨',
              team_name: '研磨',
              planned_quantity: '10',
              serial_nos: [],
            },
            {
              sequence_no: 2,
              name: '精磨',
              team_name: '研磨',
              planned_quantity: '10',
              serial_nos: [],
            },
          ],
        },
      ],
      items: [
        {
          id: 1,
          status: 'received',
          entry_kind: 'transfer',
          quantity: 10,
          weight: 2,
          next_team: { id: 2, name: '研磨' },
          process_route: { id: 1, step_index: 1 },
          on_hand_quantity: 10,
          on_hand_weight: 2,
        },
      ],
      processing_records: [
        {
          source_transfer_id: 1,
          process_route_id: 1,
          process_step_index: 0,
          completed_quantity: 10,
          completed_weight: 2,
        },
        {
          source_transfer_id: 1,
          process_route_id: 1,
          process_step_index: 1,
          completed_quantity: 6,
          completed_weight: 1.2,
        },
      ],
    } as unknown as MaterialTrace
    expect(traceProcessRows(trace)).toMatchObject([
      { received: 10, completed: 10, stock: 0 },
      { received: 0, completed: 6, stock: 10 },
    ])
  })
})
