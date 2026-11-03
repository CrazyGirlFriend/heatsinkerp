import React, { useEffect, useId, useRef, useState } from "react";
import {
  CalendarBlank,
  CaretDown,
  CaretRight,
  CaretLeft,
  CaretDoubleDown,
  CaretDoubleUp,
  FunnelSimple,
  MagnifyingGlass,
  X,
  Check,
  WarningCircle,
  MapPin,
  ArrowRight,
  ArrowsOutSimple,
  ArrowsInSimple,
  Export,
  Factory,
  Circle,
  FlagCheckered,
  PencilSimple,
  Crosshair,
} from "@phosphor-icons/react";
import {
  DAY,
  ORIGIN,
  TODAY,
  teams,
  initialOrders,
  allBatches,
  complete,
  dateAt,
  dateLabel,
  dateTime,
  dateInput,
  fromInput,
  lanes,
} from "./data";
import { traceBatch } from "./batch-flow";

const BATCH_TOP = 7,
  BATCH_HEIGHT = 34,
  LANE_HEIGHT = 36;
const stepHeight = (items) =>
  Math.max(...items.map((b) => b.lane), 0) * LANE_HEIGHT + 52;
const cx = (...values) => values.filter(Boolean).join(" ");
const status = (b) =>
  b.sent === b.qty
    ? "已转出"
    : b.late
      ? "已逾期"
      : b.stock
        ? "加工中"
        : "待加工";
const IconButton = ({ label, children, ...props }) => (
  <button className="icon-button" title={label} aria-label={label} {...props}>
    {children}
  </button>
);
const Person = ({ name }) => (
  <span className="person">
    <span className="avatar" aria-hidden="true">
      {name[0]}
    </span>
    {name}
  </span>
);

function Modal({ title, children, close, footer, wide = false }) {
  const ref = useRef(null);
  const headingId = useId();
  useEffect(() => {
    const old = document.activeElement,
      dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      old?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={cx("modal", wide && "wide")}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <header>
        <h2 id={headingId}>{title}</h2>
        <IconButton label="关闭详情" onClick={close}>
          <X />
        </IconButton>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}

function CalendarPicker({ range, setRange, close }) {
  const [month, setMonth] = useState(
    new Date(dateAt(range[0]).getFullYear(), dateAt(range[0]).getMonth(), 1),
  );
  const [start, setStart] = useState(null),
    [hover, setHover] = useState(null);
  function choose(offset) {
    if (start === null) {
      setStart(offset);
      setHover(offset);
    } else {
      setRange([Math.min(start, offset), Math.max(start, offset) + 1]);
      close();
    }
  }
  return (
    <div
      className="calendar-popover"
      role="dialog"
      aria-label="选择排期时间范围"
    >
      <header>
        <strong>时间范围</strong>
        <IconButton label="关闭日期选择" onClick={close}>
          <X />
        </IconButton>
      </header>
      <div className="calendar-presets">
        {[
          ["本周", 4, 11],
          ["两周", 0, 14],
          ["本月", 3, 33],
        ].map(([name, a, b]) => (
          <button
            key={name}
            onClick={() => {
              setRange([a, b]);
              close();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="calendar-months">
        {[0, 1].map((shift) => {
          const first = new Date(
              month.getFullYear(),
              month.getMonth() + shift,
              1,
            ),
            lead = (first.getDay() + 6) % 7,
            count = new Date(
              first.getFullYear(),
              first.getMonth() + 1,
              0,
            ).getDate();
          return (
            <section key={shift}>
              <header>
                {shift === 0 ? (
                  <IconButton
                    label="上个月"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() - 1, 1),
                      )
                    }
                  >
                    <CaretLeft />
                  </IconButton>
                ) : (
                  <span />
                )}
                <strong>
                  {first.getFullYear()} 年 {first.getMonth() + 1} 月
                </strong>
                {shift === 1 ? (
                  <IconButton
                    label="下个月"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() + 1, 1),
                      )
                    }
                  >
                    <CaretRight />
                  </IconButton>
                ) : (
                  <span />
                )}
              </header>
              <div className="calendar-days">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                  <small key={day}>{day}</small>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={"blank" + i} />
                ))}
                {Array.from({ length: count }, (_, i) => {
                  const d = new Date(
                      first.getFullYear(),
                      first.getMonth(),
                      i + 1,
                    ),
                    offset = Math.round(
                      (new Date(
                        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}T00:00:00+08:00`,
                      ).getTime() -
                        ORIGIN) /
                        DAY,
                    );
                  const low =
                      start === null
                        ? range[0]
                        : Math.min(start, hover ?? start),
                    high =
                      start === null
                        ? range[1] - 1
                        : Math.max(start, hover ?? start);
                  return (
                    <button
                      key={i}
                      aria-label={`${d.getFullYear()}年${d.getMonth() + 1}月${i + 1}日`}
                      className={cx(
                        offset >= low && offset <= high && "in-range",
                        (offset === low || offset === high) && "range-edge",
                      )}
                      onMouseEnter={() => setHover(offset)}
                      onClick={() => choose(offset)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <p>
        {start === null ? "选择开始日期，再选择结束日期" : "请选择结束日期"}
      </p>
    </div>
  );
}

function FlowConnections({ steps, links, range, headerHeight, dragging }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const arrowId = useId();
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const points = new Map();
  let top = headerHeight;
  for (const step of steps) {
    const items = lanes(step.batches, 0.05);
    for (const batch of items) {
      const delta = dragging?.id === batch.id ? dragging.delta : 0;
      points.set(batch.id, {
        start: batch.start + delta,
        end: batch.end + delta,
        y: top + BATCH_TOP + batch.lane * LANE_HEIGHT + BATCH_HEIGHT / 2,
      });
    }
    top += stepHeight(items);
  }
  const x = (time) => ((time - range[0]) / (range[1] - range[0])) * width;
  return (
    <svg ref={ref} className="flow-connections" aria-hidden="true">
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 6 6"
          refX="6"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L6 3 L0 6" fill="currentColor" />
        </marker>
      </defs>
      {width > 0 &&
        links.map((link) => {
          const from = points.get(link.from),
            to = points.get(link.to);
          if (
            !from ||
            !to ||
            from.end <= range[0] ||
            from.end > range[1] ||
            to.start < range[0] ||
            to.start >= range[1]
          )
            return null;
          const x1 = x(from.end),
            x2 = x(to.start),
            midY = (from.y + to.y) / 2;
          return (
            <path
              key={`${link.from}-${link.to}`}
              data-from={link.from}
              data-to={link.to}
              d={`M${x1} ${from.y} H${x1 + 6} V${midY} H${x2 - 6} V${to.y} H${x2}`}
              markerEnd={`url(#${arrowId})`}
            />
          );
        })}
    </svg>
  );
}

function BatchBar({
  batch,
  team,
  order,
  range,
  lane = 0,
  small = false,
  open,
  hint,
  dragging,
  startDrag,
  flow,
  selected,
  showDetail,
}) {
  const shifted =
    dragging?.id === batch.id
      ? {
          ...batch,
          start: batch.start + dragging.delta,
          end: batch.end + dragging.delta,
        }
      : batch;
  const duration = range[1] - range[0],
    left = Math.max(0, ((shifted.start - range[0]) / duration) * 100),
    right = Math.min(100, ((shifted.end - range[0]) / duration) * 100);
  if (right <= 0 || left >= 100) return null;
  const done = batch.sent === batch.qty;
  return (
    <button
      className={cx(
        "task-bar",
        small && "summary-bar",
        done && "done",
        batch.stock > 0 && "in-progress",
        batch.late && "late",
        selected && "flow-selected",
        flow && !flow.ids.has(batch.id) && "flow-muted",
        flow?.ids.has(batch.id) && "flow-related",
        dragging?.id === batch.id && "dragging",
      )}
      style={{
        left: `${left}%`,
        width: `${Math.max(0.4, right - left)}%`,
        top: small ? 14 + lane * 32 : BATCH_TOP + lane * LANE_HEIGHT,
        "--team": team.color,
        "--team-pale": team.pale,
      }}
      data-batch-id={small ? undefined : batch.id}
      aria-pressed={small ? undefined : Boolean(selected)}
      onDoubleClick={() =>
        !small && showDetail({ orderId: order.id, batchId: batch.id })
      }
      aria-label={`${order.serial} ${team.name}${small ? "" : ` 第${batch.number}批`} ${batch.qty}件 ${dateTime(batch.start)}至${dateTime(batch.end)} ${status(batch)}`}
      onPointerDown={(e) => !small && startDrag(e, batch)}
      onClick={(e) => {
        if (!e.currentTarget.dataset.dragged)
          open({ orderId: order.id, batchId: batch.id });
      }}
      onMouseEnter={(e) =>
        hint({
          batch,
          team,
          order,
          rect: e.currentTarget.getBoundingClientRect(),
        })
      }
      onMouseLeave={() => hint(null)}
      onFocus={(e) =>
        hint({
          batch,
          team,
          order,
          rect: e.currentTarget.getBoundingClientRect(),
        })
      }
      onBlur={() => hint(null)}
    >
      {!done && (
        <span
          className="bar-progress"
          style={{
            width: `${Math.min(100, (batch.processed / batch.qty) * 100)}%`,
          }}
        />
      )}
      <span className="bar-content">
        {done ? (
          <Check weight="bold" />
        ) : batch.stock > 0 ? (
          <MapPin weight="fill" />
        ) : null}
        <span>{small ? team.name : `第${batch.number}批`}</span>
        {!small && <span className="bar-qty">{batch.qty}</span>}
      </span>
      {batch.late && <WarningCircle weight="fill" className="bar-warning" />}
    </button>
  );
}

export function App() {
  const [orders, setOrders] = useState(initialOrders),
    [expanded, setExpanded] = useState(new Set(["a"])),
    [range, setRange] = useState([0, 14]);
  const [scope, setScope] = useState("all"),
    [query, setQuery] = useState(""),
    [teamFilter, setTeamFilter] = useState(""),
    [filterOpen, setFilterOpen] = useState(false),
    [calendarOpen, setCalendarOpen] = useState(false);
  const [detail, setDetail] = useState(null),
    [editing, setEditing] = useState(false),
    [form, setForm] = useState(null),
    [formError, setFormError] = useState("");
  const [hover, setHover] = useState(null),
    [dragging, setDragging] = useState(null),
    [toast, setToast] = useState(null),
    [fullscreen, setFullscreen] = useState(false),
    [undo, setUndo] = useState(null),
    [flowSelection, setFlowSelection] = useState(null);
  const scroll = useRef(null),
    datePopup = useRef(null),
    dragCleanup = useRef(null);
  const days = Array.from(
    { length: range[1] - range[0] },
    (_, i) => range[0] + i,
  );
  const selectedOrder = orders.find((o) => o.id === detail?.orderId),
    selectedBatch =
      selectedOrder &&
      allBatches(selectedOrder).find((b) => b.id === detail?.batchId),
    selectedStep = selectedOrder?.steps.find(
      (s) => s.id === selectedBatch?.stepId,
    );
  const riskCount = orders.filter((o) =>
    allBatches(o).some((b) => b.late),
  ).length;
  const visible = orders.filter(
    (o) =>
      (!query ||
        o.serial.includes(query) ||
        o.material.toLowerCase().includes(query.toLowerCase())) &&
      (!teamFilter || o.steps.some((s) => s.team === teamFilter)) &&
      (scope === "all" ||
        (scope === "risk" ? allBatches(o).some((b) => b.late) : complete(o))),
  );
  const flowOrder = visible.find(
    (o) => o.id === flowSelection?.orderId && expanded.has(o.id),
  );
  const flowBatch =
    flowOrder &&
    allBatches(flowOrder).find((b) => b.id === flowSelection.batchId);
  const flow = flowBatch && traceBatch(flowOrder.links, flowBatch.id);
  useEffect(() => {
    if (
      flowSelection &&
      (!flowOrder || (teamFilter && flowBatch?.team !== teamFilter))
    )
      setFlowSelection(null);
  }, [flowSelection, flowOrder, flowBatch?.team, teamFilter]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const f = (e) => {
      if (calendarOpen && !datePopup.current?.contains(e.target))
        setCalendarOpen(false);
    };
    document.addEventListener("pointerdown", f);
    return () => document.removeEventListener("pointerdown", f);
  }, [calendarOpen]);
  useEffect(() => {
    const f = (e) => {
      if (e.key === "Escape") {
        setCalendarOpen(false);
        setHover(null);
        if (!detail && !filterOpen) {
          if (flowSelection) setFlowSelection(null);
          else setFullscreen(false);
        }
      }
    };
    document.addEventListener("keydown", f);
    return () => {
      document.removeEventListener("keydown", f);
      dragCleanup.current?.();
    };
  }, [detail, filterOpen, flowSelection]);
  function openDetail(value) {
    setHover(null);
    setDetail(value);
    setEditing(false);
    setFormError("");
  }
  function toggle(id) {
    setExpanded((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function updateBatch(id, change) {
    setUndo(orders);
    setOrders((old) =>
      old.map((o) => ({
        ...o,
        steps: o.steps.map((s) => ({
          ...s,
          batches: s.batches.map((b) =>
            b.id === id
              ? {
                  ...b,
                  ...change,
                  late:
                    (change.end ?? b.end) < TODAY &&
                    b.sent < (change.qty ?? b.qty),
                }
              : b,
          ),
        })),
      })),
    );
  }
  function startDrag(e, batch) {
    if (e.button !== 0 || batch.sent === batch.qty) return;
    const target = e.currentTarget,
      x = e.clientX,
      width = target.parentElement.getBoundingClientRect().width;
    let delta = 0,
      moved = false;
    delete target.dataset.dragged;
    const move = (event) => {
      if (Math.abs(event.clientX - x) < 5 && !moved) return;
      moved = true;
      delta =
        Math.round(((event.clientX - x) / width) * (range[1] - range[0]) * 4) /
        4;
      target.dataset.dragged = "true";
      setHover(null);
      setDragging({ id: batch.id, delta });
    };
    const end = () => {
      cleanup();
      if (moved && delta !== 0) {
        updateBatch(batch.id, {
          start: batch.start + delta,
          end: batch.end + delta,
        });
        setToast("排期已在原型中调整");
      }
      setDragging(null);
      setTimeout(() => delete target.dataset.dragged, 0);
    };
    const cancel = () => {
      cleanup();
      setDragging(null);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      dragCleanup.current = null;
    };
    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }
  function save() {
    const start = fromInput(form.start),
      end = fromInput(form.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setFormError("转出时间必须晚于开始时间");
      return;
    }
    updateBatch(selectedBatch.id, { start, end });
    setEditing(false);
    setToast("排期已在原型中保存");
  }
  function exportPlan() {
    const rows = [
      ["流水号", "班组", "批次", "数量", "计划开始", "计划转出"],
      ...visible.flatMap((o) =>
        allBatches(o).map((b) => [
          o.serial,
          teams[b.team].name,
          b.number,
          b.qty,
          dateTime(b.start),
          dateTime(b.end),
        ]),
      ),
    ];
    const blob = new Blob(
        ["\uFEFF" + rows.map((r) => r.join(",")).join("\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "生产排期-原型.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function background() {
    return (
      <div className="track-grid" aria-hidden="true">
        {days.map((day) => (
          <span
            key={day}
            className={cx(
              [0, 6].includes(dateAt(day).getDay()) && "weekend",
              Math.floor(TODAY) === day && "today-column",
            )}
          />
        ))}
        {TODAY >= range[0] && TODAY < range[1] && (
          <i
            className="today-line"
            style={{ left: `${((TODAY - range[0]) / days.length) * 100}%` }}
          />
        )}
      </div>
    );
  }
  function bars(order, step) {
    return step
      ? lanes(
          step.batches.map((b) => ({ ...b, team: step.team })),
          0.05,
        )
      : lanes(
          order.steps.map((s) => ({
            id: s.id,
            team: s.team,
            number: 0,
            qty: order.qty,
            start: Math.min(...s.batches.map((b) => b.start)),
            end: Math.max(...s.batches.map((b) => b.end)),
            processed: s.batches.reduce((n, b) => n + b.processed, 0),
            sent: s.batches.reduce((n, b) => n + b.sent, 0),
            stock: s.batches.reduce((n, b) => n + b.stock, 0),
            late: s.batches.some((b) => b.late),
          })),
          0,
        );
  }

  return (
    <div className={cx("app", fullscreen && "fullscreen")}>
      <header className="app-header">
        <div className="app-identity">
          <span className="app-icon">
            <Factory size={23} weight="duotone" />
          </span>
          <h1>生产排期</h1>
          <span className="prototype-label">交互原型</span>
        </div>
        <div className="header-right">
          <span className="demo-notice">示例数据 · 11 月 3 日</span>
          <span className="header-divider" />
          <Person name="调度员" />
        </div>
      </header>
      <main className="workspace">
        <div className="view-header">
          <div className="view-tabs" role="tablist" aria-label="排期范围">
            {[
              ["all", "全部排期", orders.length],
              ["risk", "需关注", riskCount],
              ["done", "已完成", orders.filter(complete).length],
            ].map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={scope === key}
                className={cx(scope === key && "active")}
                onClick={() => setScope(key)}
              >
                {label}
                <span className={key === "risk" ? "risk-count" : ""}>
                  {count}
                </span>
              </button>
            ))}
          </div>
          <div className="view-actions">
            <button className="text-button" onClick={exportPlan}>
              <Export />
              导出
            </button>
            <IconButton
              label={fullscreen ? "退出全屏" : "全屏查看"}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <ArrowsInSimple /> : <ArrowsOutSimple />}
            </IconButton>
          </div>
        </div>
        <section className="board" aria-label="生产排期看板">
          <div className="board-toolbar">
            <div className="toolbar-left">
              <div className="search-field">
                <MagnifyingGlass />
                <input
                  aria-label="搜索流水号"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索流水号"
                />
                {query && (
                  <IconButton label="清空搜索" onClick={() => setQuery("")}>
                    <X />
                  </IconButton>
                )}
              </div>
              <button
                className={cx("text-button", teamFilter && "selected")}
                onClick={() => setFilterOpen(true)}
              >
                <FunnelSimple />
                筛选{teamFilter && <span className="filter-count">1</span>}
              </button>
              <span className="toolbar-divider" />
              <IconButton
                label={expanded.size ? "收起全部班组" : "展开全部班组"}
                onClick={() =>
                  setExpanded(
                    expanded.size
                      ? new Set()
                      : new Set(visible.map((o) => o.id)),
                  )
                }
              >
                {expanded.size ? <CaretDoubleUp /> : <CaretDoubleDown />}
              </IconButton>
            </div>
            <div className="toolbar-right">
              <div className="date-control" ref={datePopup}>
                <button
                  className={cx("date-trigger", calendarOpen && "selected")}
                  aria-label="选择时间范围"
                  aria-expanded={calendarOpen}
                  onClick={() => setCalendarOpen(!calendarOpen)}
                >
                  <CalendarBlank />
                  <span>
                    {dateLabel(range[0])} – {dateLabel(range[1] - 1)}
                  </span>
                  <CaretDown size={13} />
                </button>
                {calendarOpen && (
                  <CalendarPicker
                    range={range}
                    setRange={setRange}
                    close={() => setCalendarOpen(false)}
                  />
                )}
              </div>
              <div className="period-switch" role="group" aria-label="时间刻度">
                {[
                  [7, "周"],
                  [14, "双周"],
                  [30, "月"],
                ].map(([n, label]) => (
                  <button
                    key={n}
                    aria-pressed={days.length === n}
                    className={cx(days.length === n && "active")}
                    onClick={() => setRange([range[0], range[0] + n])}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="toolbar-divider" />
              <IconButton
                label="上一时间段"
                onClick={() =>
                  setRange(([a, b]) => [a - days.length, b - days.length])
                }
              >
                <CaretLeft />
              </IconButton>
              <button
                className="today-button"
                onClick={() => {
                  setRange([0, 14]);
                  scroll.current?.scrollTo({ left: 0 });
                }}
              >
                今天
              </button>
              <IconButton
                label="下一时间段"
                onClick={() =>
                  setRange(([a, b]) => [a + days.length, b + days.length])
                }
              >
                <CaretRight />
              </IconButton>
            </div>
          </div>
          <div
            className="board-scroll"
            ref={scroll}
            onScroll={() => setHover(null)}
          >
            <div
              className={cx("schedule-grid", flow && "has-flow")}
              style={{ "--days": days.length }}
              onClick={(e) => {
                if (!e.target.closest("button")) {
                  setFlowSelection(null);
                  setHover(null);
                }
              }}
            >
              <div className="grid-heading">
                <div className="identity-heading">流水号 / 班组</div>
                <div className="quantity-heading">
                  数量<span>件</span>
                </div>
                <div className="date-heading">
                  <div className="month-caption">
                    {dateAt(range[0]).getFullYear()} 年{" "}
                    {dateAt(range[0]).getMonth() + 1} 月
                    {dateAt(range[0]).getMonth() !==
                      dateAt(range[1] - 1).getMonth() && (
                      <span> — {dateAt(range[1] - 1).getMonth() + 1} 月</span>
                    )}
                  </div>
                  <div className="day-headings">
                    {days.map((day) => (
                      <div
                        key={day}
                        className={cx(
                          Math.floor(TODAY) === day && "today",
                          [0, 6].includes(dateAt(day).getDay()) && "weekend",
                        )}
                      >
                        <b>
                          {dateAt(day).getDate().toString().padStart(2, "0")}
                        </b>
                        <span>
                          {Math.floor(TODAY) === day
                            ? "今天"
                            : "日一二三四五六"[dateAt(day).getDay()]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {!visible.length && (
                <div className="empty">
                  <MagnifyingGlass size={28} />
                  <strong>没有匹配的排期</strong>
                  <button
                    onClick={() => {
                      setQuery("");
                      setScope("all");
                      setTeamFilter("");
                    }}
                  >
                    清除筛选
                  </button>
                </div>
              )}
              {visible.map((order) => {
                const summary = bars(order),
                  isOpen = expanded.has(order.id),
                  rowHeight = isOpen
                    ? 54
                    : Math.max(
                        60,
                        Math.max(...summary.map((b) => b.lane)) * 32 + 54,
                      );
                return (
                  <div
                    key={order.id}
                    className={cx(
                      "order-group",
                      flowOrder?.id === order.id && "flow-order",
                    )}
                  >
                    {flowOrder?.id === order.id && flow && (
                      <FlowConnections
                        steps={order.steps.filter(
                          (s) => !teamFilter || s.team === teamFilter,
                        )}
                        links={flow.links}
                        range={range}
                        headerHeight={rowHeight}
                        dragging={dragging}
                      />
                    )}
                    <div
                      className={cx(
                        "schedule-row",
                        "order-row",
                        isOpen && "expanded",
                      )}
                      style={{ height: rowHeight }}
                    >
                      <div className="identity-cell">
                        <IconButton
                          label={`${isOpen ? "收起" : "展开"} ${order.serial} 的班组`}
                          aria-expanded={isOpen}
                          onClick={() => toggle(order.id)}
                        >
                          <CaretRight
                            className={cx("chevron", isOpen && "open")}
                          />
                        </IconButton>
                        <button
                          className="serial-link"
                          onClick={() => openDetail({ orderId: order.id })}
                        >
                          {order.serial}
                        </button>
                        {allBatches(order).some((b) => b.late) && (
                          <WarningCircle
                            className="order-warning"
                            weight="fill"
                            aria-label="有逾期排期"
                          />
                        )}
                        {complete(order) && (
                          <Check
                            className="order-complete"
                            weight="bold"
                            aria-label="已全部完成"
                          />
                        )}
                      </div>
                      <div className="quantity-cell">
                        {order.qty.toLocaleString()}
                      </div>
                      <div className="track summary-track">
                        {background()}
                        {isOpen ? (
                          <div className="summary-range" aria-hidden="true">
                            {summary.map((b) => {
                              const left = Math.max(
                                0,
                                ((b.start - range[0]) / days.length) * 100,
                              );
                              const right = Math.min(
                                100,
                                ((b.end - range[0]) / days.length) * 100,
                              );
                              return (
                                right > left && (
                                  <span
                                    key={b.id}
                                    style={{
                                      left: `${left}%`,
                                      width: `${right - left}%`,
                                      top: 21 + b.lane * 7,
                                      background: teams[b.team].color,
                                    }}
                                  />
                                )
                              );
                            })}
                          </div>
                        ) : (
                          summary.map((b) => (
                            <BatchBar
                              key={b.id}
                              batch={b}
                              team={teams[b.team]}
                              order={order}
                              range={range}
                              lane={b.lane}
                              small
                              open={() =>
                                setExpanded(new Set([...expanded, order.id]))
                              }
                              hint={setHover}
                            />
                          ))
                        )}
                        {order.due >= range[0] && order.due <= range[1] && (
                          <button
                            className={cx(
                              "due-marker",
                              order.due - range[0] < days.length * 0.2 &&
                                "label-after",
                              order.due < TODAY &&
                                !complete(order) &&
                                "overdue",
                            )}
                            data-order-id={order.id}
                            style={{
                              left: `${((order.due - range[0]) / days.length) * 100}%`,
                            }}
                            aria-label={`${order.serial} 最终交期 ${dateTime(order.due)}`}
                            onClick={() => openDetail({ orderId: order.id })}
                          >
                            <FlagCheckered weight="duotone" size={19} />
                            <span className="due-label">
                              {dateTime(order.due)}
                            </span>
                          </button>
                        )}
                        {!summary.some(
                          (b) => b.end > range[0] && b.start < range[1],
                        ) && (
                          <button
                            className="locate-order"
                            onClick={() =>
                              setRange([
                                Math.floor(summary[0].start),
                                Math.floor(summary[0].start) + 14,
                              ])
                            }
                          >
                            <Crosshair />
                            定位排期
                          </button>
                        )}
                      </div>
                    </div>
                    {isOpen &&
                      order.steps
                        .filter((s) => !teamFilter || s.team === teamFilter)
                        .map((step, index) => {
                          const items = bars(order, step),
                            team = teams[step.team],
                            height = stepHeight(items),
                            stock = step.batches.reduce(
                              (n, b) => n + b.stock,
                              0,
                            );
                          return (
                            <div
                              key={step.id}
                              className="schedule-row step-row"
                              style={{
                                height,
                                "--team": team.color,
                                "--team-pale": team.pale,
                              }}
                            >
                              <div className="identity-cell step-identity">
                                <span className="step-number">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <Circle
                                  weight="fill"
                                  size={9}
                                  color={team.color}
                                />
                                <span className="team-name">{team.name}</span>
                                {stock > 0 && (
                                  <span
                                    className="stock-pill"
                                    title={`当前在本班组 ${stock} 件`}
                                  >
                                    <MapPin weight="fill" size={14} />
                                    {stock}
                                  </span>
                                )}
                                <span
                                  className="mini-avatar"
                                  title={team.owner}
                                >
                                  {team.owner[0]}
                                </span>
                              </div>
                              <div className="quantity-cell">
                                {step.batches.reduce((n, b) => n + b.qty, 0)}
                              </div>
                              <div className="track">
                                {background()}
                                {items.map((b) => (
                                  <BatchBar
                                    key={b.id}
                                    batch={b}
                                    team={team}
                                    order={order}
                                    range={range}
                                    lane={b.lane}
                                    open={(value) => {
                                      setFlowSelection(value);
                                      setHover(null);
                                    }}
                                    showDetail={openDetail}
                                    flow={
                                      flowOrder?.id === order.id ? flow : null
                                    }
                                    selected={flowSelection?.batchId === b.id}
                                    hint={setHover}
                                    dragging={dragging}
                                    startDrag={startDrag}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                  </div>
                );
              })}
            </div>
          </div>
          <footer className="board-footer">
            {flowBatch ? (
              <div className="flow-selection" role="status">
                <Circle
                  weight="fill"
                  size={9}
                  color={teams[flowBatch.team].color}
                />
                <strong>{flowOrder.serial}</strong>
                <span>
                  {teams[flowBatch.team].name} · 第 {flowBatch.number} 批
                </span>
                <b>{flowBatch.qty} 件</b>
                <button
                  className="flow-detail"
                  onClick={() => openDetail(flowSelection)}
                >
                  查看详情 <ArrowRight size={14} />
                </button>
                <IconButton
                  label="取消批次选择"
                  onClick={() => {
                    setFlowSelection(null);
                    setHover(null);
                  }}
                >
                  <X size={15} />
                </IconButton>
              </div>
            ) : (
              <>
                <div className="team-legend">
                  {Object.entries(teams).map(([key, t]) => (
                    <button
                      key={key}
                      className={cx(teamFilter === key && "active")}
                      onClick={() =>
                        setTeamFilter(teamFilter === key ? "" : key)
                      }
                      aria-pressed={teamFilter === key}
                    >
                      <Circle size={8} weight="fill" color={t.color} />
                      {t.name}
                    </button>
                  ))}
                </div>
                <div className="status-legend">
                  <span>
                    <Check size={13} />
                    已转出
                  </span>
                  <span>
                    <MapPin weight="fill" size={13} />
                    物料在此
                  </span>
                  <span>
                    <WarningCircle weight="fill" size={13} />
                    逾期
                  </span>
                  <span>
                    <FlagCheckered size={13} />
                    最终交期
                  </span>
                </div>
              </>
            )}
            <span className="order-count">{visible.length} 个流水号</span>
          </footer>
        </section>
      </main>
      {hover && !dragging && !detail && (
        <div
          className="bar-tooltip"
          role="tooltip"
          style={{
            left: Math.min(
              window.innerWidth - 302,
              Math.max(12, hover.rect.left),
            ),
            top:
              hover.rect.bottom + 150 > window.innerHeight
                ? hover.rect.top - 142
                : hover.rect.bottom + 9,
            "--team": hover.team.color,
          }}
        >
          <header>
            <strong>
              <Circle weight="fill" size={9} />
              {hover.team.name}
              {hover.batch.number > 0 && ` · 第 ${hover.batch.number} 批`}
            </strong>
            <span>{status(hover.batch)}</span>
          </header>
          <div>
            {dateTime(hover.batch.start)}
            <ArrowRight size={13} />
            {dateTime(hover.batch.end)}
          </div>
          <footer>
            <span>
              计划 <b>{hover.batch.qty}</b>
            </span>
            <span>
              已加工 <b>{hover.batch.processed}</b>
            </span>
            <span>
              已转出 <b>{hover.batch.sent}</b>
            </span>
          </footer>
        </div>
      )}
      {filterOpen && (
        <Modal
          title="筛选排期"
          close={() => setFilterOpen(false)}
          footer={
            <>
              <button
                className="text-button"
                onClick={() => {
                  setTeamFilter("");
                  setQuery("");
                  setScope("all");
                }}
              >
                重置
              </button>
              <button
                className="primary-button"
                onClick={() => setFilterOpen(false)}
              >
                完成
              </button>
            </>
          }
        >
          <label className="field">
            班组
            <select
              aria-label="班组"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="">全部班组</option>
              {Object.entries(teams).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            排期范围
            <select
              aria-label="排期范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">全部排期</option>
              <option value="risk">需关注</option>
              <option value="done">已完成</option>
            </select>
          </label>
        </Modal>
      )}
      {selectedOrder && (
        <Modal
          title={
            selectedBatch
              ? `${teams[selectedBatch.team].name} · 第 ${selectedBatch.number} 批`
              : "流水号详情"
          }
          close={() => setDetail(null)}
          wide={!selectedBatch}
          footer={
            <>
              <span className="modal-note">示例数据，调整仅用于原型演示</span>
              {selectedBatch ? (
                editing ? (
                  <>
                    <button
                      className="plain-button"
                      onClick={() => setEditing(false)}
                    >
                      取消
                    </button>
                    <button className="primary-button" onClick={save}>
                      保存排期
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-button"
                    disabled={selectedBatch.sent === selectedBatch.qty}
                    onClick={() => {
                      setEditing(true);
                      setForm({
                        start: dateInput(selectedBatch.start),
                        end: dateInput(selectedBatch.end),
                      });
                    }}
                  >
                    <PencilSimple />
                    调整排期
                  </button>
                )
              ) : (
                <button
                  className="primary-button"
                  onClick={() => {
                    setExpanded(new Set([...expanded, selectedOrder.id]));
                    setDetail(null);
                  }}
                >
                  查看班组计划
                </button>
              )}
            </>
          }
        >
          <div className="detail-heading">
            <strong>{selectedOrder.serial}</strong>
            <span className="material">{selectedOrder.material}</span>
            {selectedBatch && (
              <span
                className={cx("status-label", selectedBatch.late && "risk")}
              >
                {status(selectedBatch)}
              </span>
            )}
          </div>
          {selectedBatch ? (
            <>
              <div className="detail-metrics">
                <div>
                  <span>计划数量</span>
                  <strong>
                    {selectedBatch.qty}
                    <small>件</small>
                  </strong>
                </div>
                <div>
                  <span>已加工</span>
                  <strong>
                    {selectedBatch.processed}
                    <small>件</small>
                  </strong>
                </div>
                <div>
                  <span>已转出</span>
                  <strong>
                    {selectedBatch.sent}
                    <small>件</small>
                  </strong>
                </div>
              </div>
              <div
                className="detail-progress"
                style={{ "--team": teams[selectedBatch.team].color }}
              >
                <span
                  style={{
                    width: `${(selectedBatch.processed / selectedBatch.qty) * 100}%`,
                  }}
                />
              </div>
              {editing ? (
                <div className="edit-form">
                  <label className="field">
                    计划开始
                    <input
                      type="datetime-local"
                      value={form.start}
                      onChange={(e) =>
                        setForm({ ...form, start: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    计划转出
                    <input
                      type="datetime-local"
                      value={form.end}
                      onChange={(e) =>
                        setForm({ ...form, end: e.target.value })
                      }
                    />
                  </label>
                  {formError && (
                    <p className="form-error" role="alert">
                      {formError}
                    </p>
                  )}
                </div>
              ) : (
                <dl className="detail-fields">
                  <div>
                    <dt>计划开始</dt>
                    <dd>{dateTime(selectedBatch.start)}</dd>
                  </div>
                  <div>
                    <dt>计划转出</dt>
                    <dd>{dateTime(selectedBatch.end)}</dd>
                  </div>
                  <div>
                    <dt>负责人</dt>
                    <dd>
                      <Person name={teams[selectedBatch.team].owner} />
                    </dd>
                  </div>
                  <div>
                    <dt>物料在库</dt>
                    <dd>{selectedBatch.stock} 件</dd>
                  </div>
                  <div>
                    <dt>最终交期</dt>
                    <dd>{dateTime(selectedOrder.due)}</dd>
                  </div>
                  <div>
                    <dt>持续时间</dt>
                    <dd>
                      {(selectedBatch.end - selectedBatch.start).toFixed(1)} 天
                    </dd>
                  </div>
                </dl>
              )}
              {selectedBatch.late && (
                <div className="risk-note">
                  <WarningCircle weight="fill" />
                  尚有 {selectedBatch.qty - selectedBatch.sent} 件未转出
                </div>
              )}
              <div className="process-path">
                {selectedOrder.steps.map((s, i) => (
                  <React.Fragment key={s.id}>
                    {i > 0 && <ArrowRight size={14} />}
                    <span
                      className={cx(s.id === selectedBatch.stepId && "current")}
                      style={{
                        "--team": teams[s.team].color,
                        "--team-pale": teams[s.team].pale,
                      }}
                    >
                      <Circle size={7} weight="fill" />
                      {teams[s.team].name}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </>
          ) : (
            <>
              <dl className="detail-fields">
                <div>
                  <dt>交货任务</dt>
                  <dd>{selectedOrder.task}</dd>
                </div>
                <div>
                  <dt>计划数量</dt>
                  <dd>{selectedOrder.qty} 件</dd>
                </div>
                <div>
                  <dt>最终交期</dt>
                  <dd>{dateTime(selectedOrder.due)}</dd>
                </div>
                <div>
                  <dt>业务人员</dt>
                  <dd>
                    <Person name={selectedOrder.owner} />
                  </dd>
                </div>
              </dl>
              <table className="details-table">
                <thead>
                  <tr>
                    <th>班组</th>
                    <th>批次</th>
                    <th>数量</th>
                    <th>计划开始</th>
                    <th>计划转出</th>
                    <th>已转出</th>
                  </tr>
                </thead>
                <tbody>
                  {allBatches(selectedOrder).map((b) => (
                    <tr
                      key={b.id}
                      onClick={() =>
                        openDetail({ orderId: selectedOrder.id, batchId: b.id })
                      }
                    >
                      <td>
                        <button
                          className="table-link"
                          onClick={() =>
                            openDetail({
                              orderId: selectedOrder.id,
                              batchId: b.id,
                            })
                          }
                        >
                          <Circle
                            size={8}
                            weight="fill"
                            color={teams[b.team].color}
                          />
                          {teams[b.team].name}
                        </button>
                      </td>
                      <td>{b.number}</td>
                      <td>{b.qty}</td>
                      <td>{dateTime(b.start)}</td>
                      <td>{dateTime(b.end)}</td>
                      <td>{b.sent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check weight="bold" />
          {toast}
          {undo && (
            <button
              onClick={() => {
                setOrders(undo);
                setUndo(null);
                setToast("已撤销调整");
              }}
            >
              撤销
            </button>
          )}
          <IconButton label="关闭提示" onClick={() => setToast(null)}>
            <X />
          </IconButton>
        </div>
      )}
    </div>
  );
}
