import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@i18n";
import { MAP, layoutMap, mapTree } from "@utils/mindMap.js";
import { formatClock } from "@utils/notes.js";
import { svgToPng } from "@utils/svgImage.js";
import { CollapseIcon, DownloadIcon, ExpandIcon, FitIcon, IconButton, MinusIcon, PlusIcon, Spinner, cx } from "@components/shared";
import styles from "./styles.module.css";

/** Empty space around the map, also in the image. */
const MARGIN = 16;

/** Zoom limits and step of the − / + buttons. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;

/** @param {number} z */
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** Fonts of each kind of text; the family is the app's. */
const FONTS = { root: "600 14px", branch: "600 13px", item: "400 13px", sub: "400 12px" };

/** Tints of the sections, in order; muted, so the accent still stands out. */
const TONES = ["tone0", "tone1", "tone2", "tone3", "tone4"];

/**
 * The summary as a mind map: the note's title on the left, the sections that
 * are lists in the middle and one box per item on the right, tinted like its
 * section. A section folds with a click; past `MAP.maxItems` items, "+N" shows the rest. An item with a time
 * calls `onJump` with its second. Zoom with the buttons, ⌘ + wheel or a
 * trackpad pinch. `onExport` receives the map as a PNG at its real size,
 * whatever the zoom, as it looks (what is folded stays folded).
 * `short` is the short version of the lists, when the summary has it.
 * @param {{ title: string, summary: string, short?: string, onJump?: (secs: number) => void, onExport?: (png: Uint8Array) => void }} props
 */
export default function MindMap({ title, summary, short, onJump, onExport }) {
  const t = useT();
  const svg = useRef(/** @type {SVGSVGElement | null} */ (null));
  const canvas = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [zoom, setZoom] = useState(1);
  // The point of the map (in its own units) that has to stay under the pointer after zooming.
  const anchor = useRef(/** @type {{ x: number, y: number, px: number, py: number } | null} */ (null));
  const branches = useMemo(() => mapTree(summary, short), [summary, short]);
  const [state, setState] = useState(() => branches.map(() => ({ open: true, all: false })));
  const [active, setActive] = useState(/** @type {number | null} */ (null));
  const [exporting, setExporting] = useState(false);

  const measure = useMemo(() => {
    const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement("canvas").getContext("2d"));
    const family = getComputedStyle(document.body).fontFamily;
    return (/** @type {string} */ text, /** @type {keyof FONTS} */ kind) => {
      ctx.font = `${FONTS[kind]} ${family}`;
      return ctx.measureText(text).width;
    };
  }, []);
  const subtitles = useMemo(() => branches.map((b) => t("notes.map.count", { count: b.items.length })), [branches, t]);
  const map = useMemo(() => layoutMap(title, branches, subtitles, state, measure), [title, branches, subtitles, state, measure]);

  /** Zooms keeping still the point at (px, py) of the visible area; without it, the center. @param {number} next @param {number} [px] @param {number} [py] */
  const zoomTo = (next, px, py) => {
    const el = canvas.current;
    const z = clampZoom(next);
    if (!el || z === zoom) return;
    const x = px ?? el.clientWidth / 2;
    const y = py ?? el.clientHeight / 2;
    anchor.current = { x: (el.scrollLeft + x) / zoom, y: (el.scrollTop + y) / zoom, px: x, py: y };
    setZoom(z);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;

  useLayoutEffect(() => {
    const el = canvas.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.x * zoom - a.px;
    el.scrollTop = a.y * zoom - a.py;
  }, [zoom]);

  // ⌘ + wheel, and the trackpad pinch (it arrives as a wheel with ctrlKey). Not
  // passive: otherwise the whole window would zoom.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (/** @type {WheelEvent} */ e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomRef.current(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, branches.length]);

  /** The whole map in view, never above 100 %. */
  const fit = () => {
    const el = canvas.current;
    if (!el) return;
    const padding = 16;
    setZoom(clampZoom(Math.min(1, (el.clientWidth - padding) / (map.width + MARGIN * 2), (el.clientHeight - padding) / (map.height + MARGIN * 2))));
    el.scrollTo(0, 0);
  };

  if (!branches.length) return <p className={cx("muted", styles.empty)}>{t("notes.map.noLists")}</p>;

  /** @param {number} i @param {Partial<{ open: boolean, all: boolean }>} patch */
  const patch = (i, patch) => setState((s) => s.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const setAll = (/** @type {boolean} */ open) => setState(branches.map(() => ({ open, all: open })));

  const exportImage = async () => {
    if (!svg.current || !onExport) return;
    setExporting(true);
    try {
      onExport(await svgToPng(svg.current, getComputedStyle(document.body).backgroundColor));
    } finally {
      setExporting(false);
    }
  };

  /** Click and Enter/Space. @param {() => void} action */
  const press = (action) => ({
    tabIndex: 0,
    role: "button",
    onClick: action,
    onKeyDown: (/** @type {import("react").KeyboardEvent} */ e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      action();
    },
  });

  const { padX, padY, line, subLine } = MAP;
  const width = map.width + MARGIN * 2;
  const height = map.height + MARGIN * 2;

  return (
    <div className={styles.mindMap}>
      <div className={styles.bar}>
        <p className={styles.hint}>{t("notes.map.hint")}</p>
        <div className={styles.tools}>
          <div className={styles.group} role="group" aria-label={t("notes.map.zoom")}>
            <IconButton small label={t("notes.map.zoomOut")} disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom - ZOOM_STEP)}>
              <MinusIcon />
            </IconButton>
            <button className={styles.zoomValue} title={t("notes.map.zoomReset")} onClick={() => zoomTo(1)}>
              {Math.round(zoom * 100)} %
            </button>
            <IconButton small label={t("notes.map.zoomIn")} disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom + ZOOM_STEP)}>
              <PlusIcon />
            </IconButton>
            <IconButton small label={t("notes.map.fit")} onClick={fit}>
              <FitIcon />
            </IconButton>
          </div>
          <span className={styles.divider} aria-hidden />
          <IconButton small label={t("notes.map.expand")} onClick={() => setAll(true)}>
            <ExpandIcon />
          </IconButton>
          <IconButton small label={t("notes.map.collapse")} onClick={() => setAll(false)}>
            <CollapseIcon />
          </IconButton>
          {onExport && (
            <IconButton small label={t("notes.map.export")} disabled={exporting} onClick={exportImage}>
              {exporting ? <Spinner small /> : <DownloadIcon />}
            </IconButton>
          )}
        </div>
      </div>

      <div ref={canvas} className={styles.canvas}>
        <svg ref={svg} width={width * zoom} height={height * zoom} viewBox={`${-MARGIN} ${-MARGIN} ${width} ${height}`} role="img" aria-label={t("notes.map.label")}>
          <g>
            {map.edges.map((e, i) => (
              <path
                key={i}
                className={cx(styles.edge, active === e.branch && styles.isActive)}
                d={`M${e.x1},${e.y1} C${(e.x1 + e.x2) / 2},${e.y1} ${(e.x1 + e.x2) / 2},${e.y2} ${e.x2},${e.y2}`}
              />
            ))}
          </g>

          <g className={styles.root}>
            <rect x={map.root.x} y={map.root.y} width={map.root.w} height={map.root.h} rx={8} />
            {map.root.lines.map((l, i) => (
              <text key={i} x={map.root.x + padX} y={map.root.y + padY + line * i + 13}>
                {l}
              </text>
            ))}
          </g>

          {map.branches.map((b) => (
            <g
              key={b.index}
              className={cx(styles.branch, styles[TONES[b.index % TONES.length]], active === b.index && styles.isActive)}
              aria-expanded={b.open}
              aria-label={`${b.title}, ${b.subtitle}`}
              onMouseEnter={() => setActive(b.index)}
              onMouseLeave={() => setActive(null)}
              {...press(() => patch(b.index, { open: !b.open }))}
            >
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
              <text className={styles.chevron} x={b.x + padX - 1} y={b.y + 21}>
                {b.open ? "▾" : "▸"}
              </text>
              <text className={styles.branchTitle} x={b.x + padX + 15} y={b.y + 21.5}>
                {b.title}
              </text>
              <text className={styles.sub} x={b.x + padX + 15} y={b.y + 38}>
                {b.subtitle}
              </text>
            </g>
          ))}

          {map.leaves.map((l, i) => {
            const jump = l.secs !== null && onJump ? () => onJump(/** @type {number} */ (l.secs)) : null;
            return (
              <g
                key={i}
                className={cx(styles.leaf, styles[TONES[l.branch % TONES.length]], jump && styles.canJump, active === l.branch && styles.isActive)}
                aria-label={jump ? t("notes.map.jump", { time: formatClock(/** @type {number} */ (l.secs)) }) : undefined}
                {...(jump ? press(jump) : {})}
              >
                <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={8} />
                {l.lines.map((text, k) => (
                  <text key={k} x={l.x + padX} y={l.y + padY + line * k + 13}>
                    {text}
                  </text>
                ))}
                {l.subLines.map((text, k) => (
                  <text key={`s${k}`} className={styles.sub} x={l.x + padX} y={l.y + padY + 2 + line * l.lines.length + subLine * k + 12}>
                    {text}
                  </text>
                ))}
                {l.secs !== null && (
                  <text className={styles.time} x={l.x + l.w - padX} y={l.y + padY + 13} textAnchor="end">
                    {formatClock(l.secs)}
                  </text>
                )}
              </g>
            );
          })}

          {map.more.map((m) => (
            <g key={`more${m.branch}`} className={cx(styles.more, styles[TONES[m.branch % TONES.length]])} {...press(() => patch(m.branch, { all: true }))}>
              <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.h / 2} />
              <text x={m.x + m.w / 2} y={m.y + 16} textAnchor="middle">
                {t("notes.map.showMore", { count: m.hidden })}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
