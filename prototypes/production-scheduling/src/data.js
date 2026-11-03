export const DAY = 86400000;
export const ORIGIN = new Date("2026-10-29T00:00:00+08:00").getTime();
export const TODAY = 5.4;
export const teams = {
  cut: { name: "线切割", color: "#2275c7", pale: "#eaf3ff", owner: "李明" },
  heat: { name: "退火", color: "#b36320", pale: "#fff4e5", owner: "王建国" },
  grind: { name: "研磨", color: "#7760c0", pale: "#f2edfd", owner: "赵强" },
  roll: { name: "轧制", color: "#008273", pale: "#e7f6f2", owner: "刘伟" },
  inspect: { name: "检验", color: "#507f35", pale: "#eff6e9", owner: "陈静" },
};
const batch = (
  id,
  number,
  qty,
  start,
  end,
  processed = 0,
  sent = 0,
  stock = 0,
  late = false,
) => ({
  id,
  number,
  qty,
  start: Math.round(start * 24) / 24,
  end: Math.round(end * 24) / 24,
  processed,
  sent,
  stock,
  late,
});
export const initialOrders = [
  {
    id: "a",
    links: [
      { from: "a1", to: "a3" },
      { from: "a3", to: "a5" },
      { from: "a5", to: "a7" },
      { from: "a2", to: "a4" },
      { from: "a4", to: "a6" },
      { from: "a6", to: "a8" },
    ],
    serial: "691236-50",
    qty: 100,
    material: "Mo70Cu30",
    due: 10 + 17 / 24,
    task: "第一批",
    owner: "陈经理",
    steps: [
      {
        id: "a-cut",
        team: "cut",
        batches: [
          batch("a1", 1, 60, 0.3, 1.6, 60, 60),
          batch("a2", 2, 40, 1.7, 3, 40, 40),
        ],
      },
      {
        id: "a-heat",
        team: "heat",
        batches: [
          batch("a3", 1, 60, 1.8, 4.1, 60, 60),
          batch("a4", 2, 40, 3.1, 5.7, 20, 0, 40),
        ],
      },
      {
        id: "a-grind",
        team: "grind",
        batches: [
          batch("a5", 1, 60, 4.3, 6.6, 28, 0, 60),
          batch("a6", 2, 40, 5.8, 8.1),
        ],
      },
      {
        id: "a-inspect",
        team: "inspect",
        batches: [batch("a7", 1, 60, 6.8, 8.6), batch("a8", 2, 40, 8.3, 10.2)],
      },
    ],
  },
  {
    id: "b",
    links: [
      { from: "b1", to: "b2" },
      { from: "b2", to: "b3" },
    ],
    serial: "805881-5",
    qty: 240,
    material: "W80Cu20",
    due: 8 + 17 / 24,
    task: "第二批",
    owner: "孙经理",
    steps: [
      {
        id: "b-roll",
        team: "roll",
        batches: [batch("b1", 1, 240, 0.6, 3, 240, 240)],
      },
      {
        id: "b-grind",
        team: "grind",
        batches: [batch("b2", 1, 240, 3.1, 5.1, 190, 0, 240, true)],
      },
      {
        id: "b-inspect",
        team: "inspect",
        batches: [batch("b3", 1, 240, 5.4, 7.6)],
      },
    ],
  },
  {
    id: "c",
    links: [
      { from: "c1", to: "c2" },
      { from: "c2", to: "c3" },
      { from: "c3", to: "c4" },
    ],
    serial: "628349-16",
    qty: 80,
    material: "Mo50Cu50",
    due: 9 + 17 / 24,
    task: "试制",
    owner: "陈经理",
    steps: [
      {
        id: "c-cut",
        team: "cut",
        batches: [batch("c1", 1, 80, 2.3, 4.4, 80, 80)],
      },
      {
        id: "c-heat",
        team: "heat",
        batches: [batch("c2", 1, 80, 4.6, 6.2, 35, 0, 80)],
      },
      { id: "c-grind", team: "grind", batches: [batch("c3", 1, 80, 6.3, 8.1)] },
      {
        id: "c-inspect",
        team: "inspect",
        batches: [batch("c4", 1, 80, 8.2, 9.2)],
      },
    ],
  },
  {
    id: "d",
    links: [
      { from: "d1", to: "d2" },
      { from: "d2", to: "d3" },
      { from: "d3", to: "d4" },
    ],
    serial: "823766",
    qty: 160,
    material: "Mo70Cu30",
    due: 12 + 17 / 24,
    task: "补料",
    owner: "周经理",
    steps: [
      {
        id: "d-roll",
        team: "roll",
        batches: [batch("d1", 1, 160, 5.2, 7.4, 16, 0, 160)],
      },
      { id: "d-heat", team: "heat", batches: [batch("d2", 1, 160, 7.6, 9.2)] },
      {
        id: "d-grind",
        team: "grind",
        batches: [batch("d3", 1, 160, 9.3, 11.2)],
      },
      {
        id: "d-inspect",
        team: "inspect",
        batches: [batch("d4", 1, 160, 11.3, 12.3)],
      },
    ],
  },
  {
    id: "e",
    links: [
      { from: "e1", to: "e2" },
      { from: "e2", to: "e3" },
      { from: "e3", to: "e4" },
    ],
    serial: "691236-51",
    qty: 120,
    material: "Mo70Cu30",
    due: 13 + 17 / 24,
    task: "第一批",
    owner: "孙经理",
    steps: [
      { id: "e-cut", team: "cut", batches: [batch("e1", 1, 120, 6.3, 8.1)] },
      { id: "e-heat", team: "heat", batches: [batch("e2", 1, 120, 8.2, 9.7)] },
      {
        id: "e-grind",
        team: "grind",
        batches: [batch("e3", 1, 120, 9.8, 12.1)],
      },
      {
        id: "e-inspect",
        team: "inspect",
        batches: [batch("e4", 1, 120, 12.2, 13.3)],
      },
    ],
  },
  {
    id: "f",
    links: [
      { from: "f1", to: "f2" },
      { from: "f2", to: "f3" },
    ],
    serial: "701238-12",
    qty: 60,
    material: "W70Cu30",
    due: 5 + 8 / 24,
    task: "样件",
    owner: "周经理",
    steps: [
      {
        id: "f-cut",
        team: "cut",
        batches: [batch("f1", 1, 60, 0.1, 1.6, 60, 60)],
      },
      {
        id: "f-grind",
        team: "grind",
        batches: [batch("f2", 1, 60, 1.8, 3.2, 60, 60)],
      },
      {
        id: "f-inspect",
        team: "inspect",
        batches: [batch("f3", 1, 60, 3.3, 4.8, 60, 60)],
      },
    ],
  },
];
export const allBatches = (order) =>
  order.steps.flatMap((step) =>
    step.batches.map((b) => ({ ...b, team: step.team, stepId: step.id })),
  );
export const complete = (order) =>
  order.steps.at(-1).batches.every((b) => b.sent === b.qty);
export const dateAt = (offset) => new Date(ORIGIN + offset * DAY);
export const dateLabel = (offset) =>
  dateAt(offset).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  });
export const dateTime = (offset) =>
  dateAt(offset).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export const dateInput = (offset) =>
  new Date(ORIGIN + offset * DAY + 8 * 3600000).toISOString().slice(0, 16);
export const fromInput = (value) =>
  (new Date(value + "+08:00").getTime() - ORIGIN) / DAY;
export function lanes(items, gap = 0) {
  const ends = [];
  return [...items]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => {
      let lane = ends.findIndex((end) => end + gap <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.end;
      return { ...item, lane };
    });
}
