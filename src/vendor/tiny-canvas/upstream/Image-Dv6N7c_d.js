import { jsxs as X, jsx as s, Fragment as nr } from "react/jsx-runtime";
import { createContext as or, useCallback as be, isValidElement as Et, Children as Nt, useState as O, useRef as re, useEffect as de, useLayoutEffect as Qe, useMemo as Ke, cloneElement as ar, useId as xt, useContext as et } from "react";
import { createPortal as ir } from "react-dom";
import cr from "react-markdown";
const We = or(null), sr = "tiny-canvas-pages";
function He(e) {
  return e.length > 1 ? e.replace(/\/$/, "") : e;
}
function lr(e) {
  return e.startsWith("#/") ? He(e.slice(1).split(/[?#]/, 1)[0]) : null;
}
function Tt(e) {
  return He(e.id || e.href);
}
function ur(e) {
  const t = window.location.hash.indexOf("?"), r = t < 0 ? "" : window.location.hash.slice(t);
  return `#${Tt(e)}${r}`;
}
function dr() {
  if (typeof document > "u" || typeof window > "u")
    return null;
  const e = document.getElementById(sr);
  if (!(e != null && e.textContent))
    return null;
  try {
    const t = JSON.parse(e.textContent);
    return Array.isArray(t.pages) ? t : null;
  } catch {
    return null;
  }
}
function tt() {
  return dr();
}
function fr(e = tt()) {
  return (e == null ? void 0 : e.environment) === "dev" ? "dev" : "prod";
}
function Lt(e = tt()) {
  if (!e)
    return null;
  const t = He(window.location.pathname);
  let r = e.pages.findIndex(
    (o) => He(o.href) === t
  ), n = !1;
  if (r < 0) {
    const o = lr(window.location.hash);
    o && (r = e.pages.findIndex(
      (a) => Tt(a) === o
    ), n = r >= 0);
  }
  return r < 0 ? null : {
    ...e,
    currentIndex: r,
    currentPage: e.pages[r],
    hashRoute: n
  };
}
function hr({ title: e }) {
  const t = Lt();
  if (!t || t.pages.length < 2)
    return null;
  const { currentIndex: r, currentPage: n, pages: o, hashRoute: a } = t, l = typeof e == "string" && e.trim() ? e : n.title;
  return /* @__PURE__ */ X("details", { className: "tc-canvas-pages tc-no-drag", children: [
    /* @__PURE__ */ X("summary", { className: "tc-canvas-pages-trigger", children: [
      /* @__PURE__ */ s("span", { className: "tc-canvas-pages-label", children: l }),
      /* @__PURE__ */ X("span", { className: "tc-canvas-pages-count", children: [
        r + 1,
        "/",
        o.length
      ] }),
      /* @__PURE__ */ s(
        "svg",
        {
          viewBox: "0 0 12 12",
          width: "12",
          height: "12",
          "aria-hidden": "true",
          children: /* @__PURE__ */ s(
            "path",
            {
              d: "M3 4.5 6 7.5l3-3",
              fill: "none",
              stroke: "currentColor",
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: "1.5"
            }
          )
        }
      )
    ] }),
    /* @__PURE__ */ s("ul", { className: "tc-canvas-pages-menu", "aria-label": "Canvas pages", children: o.map((i) => /* @__PURE__ */ s("li", { children: /* @__PURE__ */ s(
      "a",
      {
        href: a ? ur(i) : i.href,
        className: "tc-canvas-pages-link",
        "aria-current": i.id === n.id ? "page" : void 0,
        children: i.title
      }
    ) }, i.id)) })
  ] });
}
const St = Symbol("tiny-canvas-child");
function Ie(e) {
  return e[St] = !0, e;
}
function pr(e) {
  var t;
  return ((t = e == null ? void 0 : e.type) == null ? void 0 : t[St]) === !0;
}
async function It(e) {
  var n;
  if ((n = navigator.clipboard) != null && n.writeText) {
    await navigator.clipboard.writeText(e);
    return;
  }
  const t = document.createElement("textarea");
  t.value = e, t.setAttribute("readonly", ""), t.style.position = "fixed", t.style.opacity = "0", document.body.append(t), t.select();
  const r = document.execCommand("copy");
  if (t.remove(), !r)
    throw new Error("Clipboard copy was rejected.");
}
function mr({ reload: e = !1 } = {}) {
  return be(() => {
    try {
      localStorage.removeItem("tiny-canvas-queue");
    } catch (t) {
      console.error("Error clearing canvas state:", t);
    }
    e && window.location.reload();
  }, [e]);
}
const $t = "tiny-canvas-queue";
function Ue() {
  const e = JSON.parse(localStorage.getItem($t)) || [];
  if (!Array.isArray(e))
    throw new TypeError("Stored canvas state must be an array.");
  return e;
}
function At(e, t) {
  const r = Ue(), n = r.findIndex((a) => a.id === e), o = {
    ...n >= 0 ? r[n] : {},
    ...t,
    id: e,
    time: (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")
  };
  n >= 0 ? r[n] = o : r.push(o), localStorage.setItem($t, JSON.stringify(r));
}
function gr(e) {
  let t = 5381;
  for (let r = 0; r < e.length; r++)
    t = (t << 5) + t + e.charCodeAt(r) >>> 0;
  return t.toString(16).padStart(8, "0");
}
function Mt(e) {
  var a;
  if (e == null || typeof e == "boolean") return "";
  if (typeof e == "string" || typeof e == "number") return "#text";
  const t = e.type, r = typeof t == "function" ? t.displayName || t.name || "Anonymous" : typeof t == "string" ? t : "Fragment", n = (a = e.props) == null ? void 0 : a.children;
  if (n == null) return r;
  const o = [];
  return Nt.forEach(n, (l) => {
    const i = Mt(l);
    i && o.push(i);
  }), o.length ? `${r}(${o.join(",")})` : r;
}
const wr = (e, t) => {
  const r = Et(e) && e.key !== null ? `key:${e.key}` : `${Mt(e)}:${t}`;
  return `tc-block-${gr(r)}`;
}, yr = (e) => {
  if (typeof localStorage > "u")
    return null;
  try {
    const r = Ue().find((n) => n.id === e);
    return !r || !Number.isFinite(r.x) || !Number.isFinite(r.y) ? null : { x: r.x, y: r.y };
  } catch (t) {
    return console.error("Error getting saved coordinates:", t), null;
  }
}, br = (e, t) => {
  if (!(typeof localStorage > "u"))
    try {
      At(e, {
        x: t.x,
        y: t.y
      });
    } catch (r) {
      console.error("Error saving block position:", r);
    }
}, vr = (e) => {
  if (typeof localStorage > "u")
    return null;
  try {
    const r = Ue().find((n) => n.id === e);
    return !r || !Number.isFinite(r.width) || !Number.isFinite(r.height) ? null : { width: r.width, height: r.height };
  } catch (t) {
    return console.error("Error getting saved size:", t), null;
  }
}, dt = (e, t) => {
  if (!(typeof localStorage > "u"))
    try {
      At(e, {
        width: t.width,
        height: t.height
      });
    } catch (r) {
      console.error("Error saving block size:", r);
    }
}, kr = (e) => {
  if (typeof localStorage > "u")
    return [];
  try {
    return Ue().flatMap((r) => {
      const n = e.get(r.id);
      if (!n)
        return [];
      const o = {
        component: n.component,
        ...Number.isInteger(n.index) ? { index: n.index } : {},
        ...n.key === void 0 ? {} : { key: n.key },
        ...n.pageId === void 0 ? {} : { pageId: n.pageId },
        ...n.pageTitle === void 0 ? {} : { pageTitle: n.pageTitle },
        id: n.sourceId ?? r.id
      };
      for (const a of ["x", "y", "width", "height"])
        Number.isFinite(r[a]) && (o[a] = r[a]);
      return ["x", "y", "width", "height"].some(
        (a) => a in o
      ) ? [o] : [];
    });
  } catch (t) {
    return console.error("Error getting canvas changes:", t), [];
  }
}, Er = (e) => [
  "Apply these Tiny Canvas layout changes to the matching JSX components:",
  JSON.stringify(e, null, 2)
].join(`
`), Me = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2], qe = Me.indexOf(1), Nr = 40, xr = 1e4, Tr = 1e4;
function ft(e, t) {
  if (!Number.isFinite(e) || e <= 0)
    throw new TypeError(`Canvas ${t} must be a positive finite number.`);
  return e;
}
function Qr({
  children: e,
  title: t,
  canvasWidth: r = xr,
  canvasHeight: n = Tr,
  dotted: o = !1,
  grid: a = !1,
  gridSize: l = 36,
  colorMode: i = "auto",
  resettable: p = !1,
  resetLabel: y = "Reset board",
  copyable: A = p,
  copyLabel: T = "Copy changes",
  copiedLabel: w = "Copied",
  onCopyChanges: H,
  className: z,
  style: Y,
  onPointerDown: J,
  onWheel: ne,
  onSelectionChange: b,
  onReset: N,
  ...I
}) {
  const [$, G] = O(null), [Z, we] = O("idle"), [Q, C] = O(qe), R = re(null), v = re(qe), B = re(0), V = re(null), K = re(null), D = mr({ reload: !0 });
  de(
    () => () => clearTimeout(K.current),
    []
  );
  const P = o || a, _ = Me[Q], g = ft(r, "canvasWidth"), d = ft(n, "canvasHeight"), f = tt(), x = Lt(f), W = x == null ? void 0 : x.currentPage.id, oe = /* @__PURE__ */ new Set(), fe = /* @__PURE__ */ new Map(), ye = be((u, k, M) => {
    const U = R.current, le = Math.max(
      0,
      Math.min(Me.length - 1, u)
    ), ce = v.current;
    if (!U || le === ce)
      return;
    const F = U.getBoundingClientRect(), ae = k - F.left, c = M - F.top, h = Me[ce];
    V.current = {
      canvas: U,
      contentX: (U.scrollLeft + ae) / h,
      contentY: (U.scrollTop + c) / h,
      viewportX: ae,
      viewportY: c
    }, v.current = le, C(le);
  }, []), Ee = (u) => {
    const k = R.current;
    if (!k)
      return;
    const M = k.getBoundingClientRect();
    ye(
      u,
      M.left + k.clientWidth / 2,
      M.top + k.clientHeight / 2
    );
  }, ve = be(
    (u, k, M) => {
      if (B.current -= u, Math.abs(B.current) < Nr)
        return;
      const U = Math.sign(B.current);
      B.current = 0, ye(v.current + U, k, M);
    },
    [ye]
  );
  Qe(() => {
    const u = V.current;
    u && (u.canvas.scrollLeft = u.contentX * _ - u.viewportX, u.canvas.scrollTop = u.contentY * _ - u.viewportY, V.current = null);
  }, [_]), de(() => {
    const u = R.current;
    if (!u)
      return;
    const k = (M) => {
      !M.ctrlKey && !M.metaKey || M.deltaY === 0 || (M.preventDefault(), ve(M.deltaY, M.clientX, M.clientY));
    };
    return u.addEventListener("wheel", k, { passive: !1 }), () => u.removeEventListener("wheel", k);
  }, [ve]), de(() => {
    const u = new URL(window.location.href), k = u.hash.indexOf("?"), U = new URLSearchParams(
      k === -1 ? "" : u.hash.slice(k + 1)
    ).get("tcFrame") || u.searchParams.get("tcFrame"), le = R.current;
    if (!U || !le)
      return;
    let ce, F = 0;
    const ae = () => {
      const c = [...le.querySelectorAll("[data-block-id]")].find(
        (h) => h.dataset.blockId === U || h.id === U
      );
      if (c) {
        c.scrollIntoView({
          behavior: "auto",
          block: "center",
          inline: "center"
        }), c.focus({ preventScroll: !0 });
        const h = c.getBoundingClientRect(), j = Math.abs(h.left + h.width / 2 - window.innerWidth / 2) < 2, q = Math.abs(h.top + h.height / 2 - window.innerHeight / 2) < 2;
        if (j && q) return;
      }
      F += 1, F < 40 && (ce = window.setTimeout(ae, 100));
    };
    return ce = window.setTimeout(ae, 0), () => window.clearTimeout(ce);
  }, [W]);
  const pe = Ke(
    () => ({
      selectedBlockId: $,
      selectBlock: (u) => {
        G(u), b == null || b(u);
      },
      zoom: _,
      zoomByWheel: ve
    }),
    [b, $, _, ve]
  ), Ne = Nt.map(e, (u, k) => {
    var ae;
    if (u == null || u === !1)
      return null;
    if (!Et(u) || !pr(u))
      throw new TypeError(
        "Canvas only accepts authorized canvas components such as <Block>, <Frame>, <Note>, <Mark>, <Link>, and <Image>."
      );
    const M = u.type.displayName || u.type.name || "Canvas component", U = (ae = f == null ? void 0 : f.widgets) == null ? void 0 : ae[M], le = U && typeof U == "object" ? Object.fromEntries(
      Object.entries(U).filter(
        ([c]) => !["id", "blockId", "children"].includes(c)
      )
    ) : {}, ce = u.props.id || wr(u, k), F = W ? `tc-page:${encodeURIComponent(W)}:${ce}` : ce;
    if (oe.has(F))
      throw new TypeError(`Canvas block IDs must be unique: "${F}".`);
    return oe.add(F), fe.set(F, {
      component: M,
      index: k,
      sourceId: ce,
      ...W ? { pageId: W, pageTitle: t || x.currentPage.title } : {},
      ...u.key === null ? {} : { key: String(u.key) }
    }), ar(u, {
      ...le,
      ...u.props,
      key: F,
      blockId: F
    });
  });
  return /* @__PURE__ */ s(We.Provider, { value: pe, children: /* @__PURE__ */ X(
    "main",
    {
      ...I,
      ref: R,
      className: ["tc-canvas", z].filter(Boolean).join(" "),
      "data-dotted": P || void 0,
      "data-color-mode": i !== "auto" ? i : void 0,
      style: {
        "--tc-grid-size": `${l}px`,
        ...Y
      },
      onPointerDown: (u) => {
        u.target === u.currentTarget && pe.selectBlock(null), J == null || J(u);
      },
      onWheel: ne,
      children: [
        /* @__PURE__ */ s(hr, { title: t }),
        /* @__PURE__ */ s(
          "div",
          {
            className: "tc-canvas-board",
            style: {
              "--tc-canvas-zoom": _,
              "--tc-canvas-width": `${g}px`,
              "--tc-canvas-height": `${d}px`
            },
            onPointerDown: (u) => {
              u.target === u.currentTarget && pe.selectBlock(null);
            },
            children: Ne
          }
        ),
        /* @__PURE__ */ X("div", { className: "tc-canvas-controls tc-no-drag", children: [
          /* @__PURE__ */ X("div", { className: "tc-canvas-zoom", role: "group", "aria-label": "Canvas zoom", children: [
            /* @__PURE__ */ s(
              "button",
              {
                type: "button",
                className: "tc-canvas-control tc-canvas-zoom-button",
                "aria-label": "Zoom out",
                disabled: Q === 0,
                onClick: () => Ee(v.current - 1),
                children: "−"
              }
            ),
            /* @__PURE__ */ X(
              "button",
              {
                type: "button",
                className: "tc-canvas-control tc-canvas-zoom-value",
                "aria-label": "Reset zoom",
                onClick: () => Ee(qe),
                children: [
                  Math.round(_ * 100),
                  "%"
                ]
              }
            ),
            /* @__PURE__ */ s(
              "button",
              {
                type: "button",
                className: "tc-canvas-control tc-canvas-zoom-button",
                "aria-label": "Zoom in",
                disabled: Q === Me.length - 1,
                onClick: () => Ee(v.current + 1),
                children: "+"
              }
            )
          ] }),
          p ? /* @__PURE__ */ s(
            "button",
            {
              type: "button",
              className: "tc-canvas-control",
              onClick: N || D,
              children: y
            }
          ) : null,
          A ? /* @__PURE__ */ s(
            "button",
            {
              type: "button",
              className: "tc-canvas-control",
              onClick: async () => {
                const u = kr(fe), k = Er(u);
                try {
                  await It(k);
                } catch (M) {
                  console.error("Error copying canvas changes:", M), we("failed");
                  return;
                }
                we("copied"), H == null || H(u, k), clearTimeout(K.current), K.current = setTimeout(
                  () => we("idle"),
                  1600
                );
              },
              children: Z === "copied" ? w : Z === "failed" ? "Copy failed" : T
            }
          ) : null
        ] })
      ]
    }
  ) });
}
var Ye = { dragStart: !0 }, Ze = { delay: 0, distance: 3 };
function Lr(e, t = {}) {
  let r, n, { bounds: o, axis: a = "both", gpuAcceleration: l = !0, legacyTranslate: i = !1, transform: p, applyUserSelectHack: y = !0, disabled: A = !1, ignoreMultitouch: T = !1, recomputeBounds: w = Ye, grid: H, threshold: z = Ze, position: Y, cancel: J, handle: ne, defaultClass: b = "neodrag", defaultClassDragging: N = "neodrag-dragging", defaultClassDragged: I = "neodrag-dragged", defaultPosition: $ = { x: 0, y: 0 }, onDragStart: G, onDrag: Z, onDragEnd: we } = t, Q = !1, C = !1, R = 0, v = !1, B = !1, V = 0, K = 0, D = 0, P = 0, _ = 0, g = 0, { x: d, y: f } = Y ? { x: (Y == null ? void 0 : Y.x) ?? 0, y: (Y == null ? void 0 : Y.y) ?? 0 } : $;
  M(d, f);
  let x, W, oe, fe, ye, Ee = "", ve = !!Y;
  w = { ...Ye, ...w }, z = { ...Ze, ...z ?? {} };
  let pe = /* @__PURE__ */ new Set();
  function Ne(c) {
    Q && !C && B && v && ye && (C = !0, (function(h) {
      U("neodrag:start", G, h);
    })(c), k.add(N), y && (Ee = u.userSelect, u.userSelect = "none"));
  }
  const u = document.body.style, k = e.classList;
  function M(c = V, h = K) {
    if (!p) {
      if (i) {
        let q = `${+c}px, ${+h}px`;
        return De(e, "transform", l ? `translate3d(${q}, 0)` : `translate(${q})`);
      }
      return De(e, "translate", `${+c}px ${+h}px`);
    }
    const j = p({ offsetX: c, offsetY: h, rootNode: e });
    Ve(j) && De(e, "transform", j);
  }
  function U(c, h, j) {
    const q = /* @__PURE__ */ (function(ie) {
      return { offsetX: V, offsetY: K, rootNode: e, currentNode: ye, event: ie };
    })(j);
    e.dispatchEvent(new CustomEvent(c, { detail: q })), h == null || h(q);
  }
  const le = addEventListener, ce = new AbortController(), F = { signal: ce.signal, capture: !1 };
  function ae() {
    let c = e.offsetWidth / W.width;
    return isNaN(c) && (c = 1), c;
  }
  return De(e, "touch-action", "none"), le("pointerdown", ((c) => {
    if (A || c.button === 2) return;
    if (pe.add(c.pointerId), T && pe.size > 1) return c.preventDefault();
    if (w.dragStart && (x = Xe(o, e)), Ve(ne) && Ve(J) && ne === J) throw new Error("`handle` selector can't be same as `cancel` selector");
    if (k.add(b), oe = (function(S, se) {
      if (!S) return [se];
      if (Je(S)) return [S];
      if (Array.isArray(S)) return S;
      const E = se.querySelectorAll(S);
      if (E === null) throw new Error("Selector passed for `handle` option should be child of the element on which the action is applied");
      return Array.from(E.values());
    })(ne, e), fe = (function(S, se) {
      if (!S) return [];
      if (Je(S)) return [S];
      if (Array.isArray(S)) return S;
      const E = se.querySelectorAll(S);
      if (E === null) throw new Error("Selector passed for `cancel` option should be child of the element on which the action is applied");
      return Array.from(E.values());
    })(J, e), r = /(both|x)/.test(a), n = /(both|y)/.test(a), pt(fe, oe)) throw new Error("Element being dragged can't be a child of the element on which `cancel` is applied");
    const h = c.composedPath()[0];
    if (!oe.some(((S) => {
      var se;
      return S.contains(h) || ((se = S.shadowRoot) == null ? void 0 : se.contains(h));
    })) || pt(fe, [h])) return;
    ye = oe.length === 1 ? e : oe.find(((S) => S.contains(h))), Q = !0, R = Date.now(), z.delay || (v = !0), W = e.getBoundingClientRect();
    const { clientX: j, clientY: q } = c, ie = ae();
    r && (D = j - d / ie), n && (P = q - f / ie), x && (_ = j - W.left, g = q - W.top);
  }), F), le("pointermove", ((c) => {
    if (!Q || T && pe.size > 1) return;
    if (!C) {
      if (v || Date.now() - R >= z.delay && (v = !0, Ne(c)), !B) {
        const ie = c.clientX - D, S = c.clientY - P;
        Math.sqrt(ie ** 2 + S ** 2) >= z.distance && (B = !0, Ne(c));
      }
      if (!C) return;
    }
    w.drag && (x = Xe(o, e)), c.preventDefault(), W = e.getBoundingClientRect();
    let h = c.clientX, j = c.clientY;
    const q = ae();
    if (x) {
      const ie = { left: x.left + _, top: x.top + g, right: x.right + _ - W.width, bottom: x.bottom + g - W.height };
      h = ht(h, ie.left, ie.right), j = ht(j, ie.top, ie.bottom);
    }
    if (Array.isArray(H)) {
      let [ie, S] = H;
      if (isNaN(+ie) || ie < 0) throw new Error("1st argument of `grid` must be a valid positive number");
      if (isNaN(+S) || S < 0) throw new Error("2nd argument of `grid` must be a valid positive number");
      let se = h - D, E = j - P;
      [se, E] = Sr([ie / q, S / q], se, E), h = D + se, j = P + E;
    }
    r && (V = Math.round((h - D) * q)), n && (K = Math.round((j - P) * q)), d = V, f = K, U("neodrag", Z, c), M();
  }), F), le("pointerup", ((c) => {
    pe.delete(c.pointerId), Q && (C && (le("click", ((h) => h.stopPropagation()), { once: !0, signal: ce.signal, capture: !0 }), w.dragEnd && (x = Xe(o, e)), k.remove(N), k.add(I), y && (u.userSelect = Ee), U("neodrag:end", we, c), r && (D = V), n && (P = K)), Q = !1, C = !1, v = !1, B = !1);
  }), F), { destroy: () => ce.abort(), update: (c) => {
    var j, q;
    a = c.axis || "both", A = c.disabled ?? !1, T = c.ignoreMultitouch ?? !1, ne = c.handle, o = c.bounds, w = c.recomputeBounds ?? Ye, J = c.cancel, y = c.applyUserSelectHack ?? !0, H = c.grid, l = c.gpuAcceleration ?? !0, i = c.legacyTranslate ?? !1, p = c.transform, z = { ...Ze, ...c.threshold ?? {} };
    const h = k.contains(I);
    k.remove(b, I), b = c.defaultClass ?? "neodrag", N = c.defaultClassDragging ?? "neodrag-dragging", I = c.defaultClassDragged ?? "neodrag-dragged", k.add(b), h && k.add(I), ve && (d = V = ((j = c.position) == null ? void 0 : j.x) ?? V, f = K = ((q = c.position) == null ? void 0 : q.y) ?? K, M());
  } };
}
var ht = (e, t, r) => Math.min(Math.max(e, t), r), Ve = (e) => typeof e == "string", Sr = ([e, t], r, n) => {
  const o = (a, l) => l === 0 ? 0 : Math.ceil(a / l) * l;
  return [o(r, e), o(n, t)];
}, pt = (e, t) => e.some(((r) => t.some(((n) => r.contains(n)))));
function Xe(e, t) {
  if (e === void 0) return;
  if (Je(e)) return e.getBoundingClientRect();
  if (typeof e == "object") {
    const { top: n = 0, left: o = 0, right: a = 0, bottom: l = 0 } = e;
    return { top: n, right: window.innerWidth - a, bottom: window.innerHeight - l, left: o };
  }
  if (e === "parent") return t.parentNode.getBoundingClientRect();
  const r = document.querySelector(e);
  if (r === null) throw new Error("The selector provided for bound doesn't exists in the document.");
  return r.getBoundingClientRect();
}
var De = (e, t, r) => e.style.setProperty(t, r), Je = (e) => e instanceof HTMLElement;
function Ce(e) {
  return e == null || typeof e == "string" || e instanceof HTMLElement ? e : "current" in e ? e.current : Array.isArray(e) ? e.map(((t) => t instanceof HTMLElement ? t : t.current)) : void 0;
}
function Ir(e, t = {}) {
  const r = re(), [n, o] = O(!1), [a, l] = O();
  let { onDragStart: i, onDrag: p, onDragEnd: y, handle: A, cancel: T } = t, w = Ce(A), H = Ce(T);
  function z(b, N) {
    l(b), N == null || N(b);
  }
  function Y(b) {
    o(!0), z(b, i);
  }
  function J(b) {
    z(b, p);
  }
  function ne(b) {
    o(!1), z(b, y);
  }
  return de((() => {
    if (typeof window > "u") return;
    const b = e.current;
    if (!b) return;
    ({ onDragStart: i, onDrag: p, onDragEnd: y } = t);
    const { update: N, destroy: I } = Lr(b, { ...t, handle: w, cancel: H, onDragStart: Y, onDrag: J, onDragEnd: ne });
    return r.current = N, I;
  }), []), de((() => {
    var b;
    (b = r.current) == null || b.call(r, { ...t, handle: Ce(A), cancel: Ce(T), onDragStart: Y, onDrag: J, onDragEnd: ne });
  }), [t]), { isDragging: n, dragState: a };
}
const $r = 250;
function mt(e, t) {
  if (!Number.isFinite(e))
    throw new TypeError(`Block ${t} must be a finite number.`);
  return Math.max(0, e);
}
const Fe = ({ x: e, y: t }) => ({
  x: Math.max(0, e),
  y: Math.max(0, t)
});
function Rt({
  children: e,
  id: t,
  blockId: r,
  x: n = 0,
  y: o = 0,
  selected: a,
  onPositionChange: l,
  onPositionCommit: i,
  persistPosition: p = !0,
  onSelectionChange: y,
  className: A,
  style: T,
  onFocus: w,
  onKeyDown: H,
  onPointerDown: z,
  ...Y
}) {
  const J = mt(n, "x"), ne = mt(o, "y"), b = xt().replaceAll(":", ""), N = r ?? t ?? `tc-block-${b}`, I = re(null), [$] = O(
    () => p ? yr(N) : null
  ), G = et(We), [Z, we] = O(!1), [Q, C] = O(!1), [R, v] = O(
    () => $ ? Fe($) : {
      x: J,
      y: ne
    }
  ), [B, V] = O(
    Math.random() < 0.5 ? -0.5 : 0.5
  );
  Qe(() => {
    p || v(Fe({ x: n, y: o }));
  }, [p, n, o]);
  const K = a ?? (G ? G.selectedBlockId === N : Z), D = (g) => {
    a === void 0 && (G ? G.selectBlock(g ? N : null) : we(g)), g !== K && (y == null || y(g));
  };
  de(() => {
    const g = I.current;
    if (!g || !$ || $.x === n && $.y === o)
      return;
    g.classList.add("tc-block-translating"), C(!0);
    const d = setTimeout(() => {
      g.classList.remove("tc-block-translating"), C(!1);
    }, $r * 4);
    return () => clearTimeout(d);
  }, [$, n, o]);
  const { isDragging: P } = Ir(I, {
    axis: "both",
    threshold: { distance: 30 },
    cancel: ".tc-no-drag",
    defaultClass: "tc-block-draggable",
    defaultClassDragging: "tc-block-dragging",
    defaultClassDragged: "tc-block-dragged",
    applyUserSelectHack: !0,
    position: R,
    transform: ({ offsetX: g, offsetY: d }) => `translate3d(${Math.max(0, g)}px, ${Math.max(0, d)}px, 0)`,
    onDrag: ({ offsetX: g, offsetY: d }) => {
      const f = Fe({ x: g, y: d });
      v(f), l == null || l(f);
    },
    onDragEnd: ({ offsetX: g, offsetY: d }) => {
      const f = Fe({ x: g, y: d });
      v(f), p && br(N, f), l == null || l(f), i == null || i(f);
    }
  });
  de(() => {
    V(Math.random() < 0.5 ? -0.5 : 0.5);
  }, [P]);
  const _ = P || Q ? `${B}deg` : "0deg";
  return /* @__PURE__ */ s(
    "article",
    {
      ...Y,
      ref: I,
      id: t ?? N,
      className: ["tc-block", A].filter(Boolean).join(" "),
      "data-block-id": N,
      "data-selected": K || void 0,
      tabIndex: 0,
      style: {
        ...T,
        cursor: P ? "grabbing" : "grab"
      },
      onFocus: (g) => {
        D(!0), w == null || w(g);
      },
      onKeyDown: (g) => {
        g.key === "Escape" && (D(!1), g.currentTarget.blur()), H == null || H(g);
      },
      onPointerDown: (g) => {
        D(!0), z == null || z(g);
      },
      children: /* @__PURE__ */ s(
        "div",
        {
          className: "tc-block-content",
          style: {
            transform: P || Q ? `rotate(${_})` : void 0,
            transition: "transform ease-in-out 150ms"
          },
          children: e
        }
      )
    }
  );
}
Rt.displayName = "Block";
const Dt = Ie(Rt);
function Ae(e, t, r) {
  if (e !== void 0) {
    if (!Number.isFinite(e) || e <= 0)
      throw new TypeError(
        `${r} ${t} must be a positive finite number.`
      );
    return e;
  }
}
function Ge(e, t, r, n) {
  const o = Math.max(
    r,
    e,
    n * t
  );
  return {
    width: o,
    height: Math.round(o / t)
  };
}
function Oe({
  children: e,
  componentName: t,
  resizeLabel: r,
  defaultWidth: n,
  defaultHeight: o,
  width: a = n,
  height: l = o,
  minWidth: i,
  minHeight: p,
  aspectRatio: y,
  onSizeChange: A,
  onSizeCommit: T,
  persistSize: w = !0,
  id: H,
  blockId: z,
  className: Y,
  style: J,
  surfaceClassName: ne,
  ...b
}) {
  const N = Ae(a, "width", t), I = Ae(l, "height", t), $ = Ae(i, "minWidth", t) ?? 0, G = Ae(p, "minHeight", t) ?? 0, Z = Ae(
    y,
    "aspectRatio",
    t
  ), we = xt().replaceAll(":", ""), Q = z ?? H ?? `tc-${t.toLowerCase()}-${we}`, C = re(null), R = re(null), v = re(null), B = re(Z), V = et(We), K = (V == null ? void 0 : V.zoom) ?? 1, [D, P] = O(() => {
    const d = w ? vr(Q) : null;
    return {
      width: (d == null ? void 0 : d.width) === void 0 ? N : Math.max($, d.width),
      height: (d == null ? void 0 : d.height) === void 0 ? I : Math.max(G, d.height)
    };
  });
  Qe(() => {
    w || P({ width: N, height: I });
  }, [I, N, w]), de(() => {
    !Z || B.current === Z || (B.current = Z, P((d) => {
      const f = Ge(
        d.width ?? N,
        Z,
        $,
        G
      );
      return v.current = f, f;
    }));
  }, [N, Z, G, $]);
  const _ = (d, f = !1) => {
    v.current = d, P(d), A == null || A(d), f && w && dt(Q, d);
  }, g = (d) => {
    const f = R.current;
    if (!f || f.pointerId !== d.pointerId)
      return;
    const x = v.current;
    R.current = null, x && (w && dt(Q, x), T == null || T(x));
  };
  return /* @__PURE__ */ X(
    Dt,
    {
      ...b,
      id: H,
      blockId: Q,
      className: ["tc-resizable-block", Y].filter(Boolean).join(" "),
      style: {
        ...J,
        ...D.width === void 0 ? {} : { width: D.width },
        ...D.height === void 0 ? {} : { height: D.height }
      },
      children: [
        /* @__PURE__ */ s(
          "div",
          {
            ref: C,
            className: ["tc-resizable-surface", ne].filter(Boolean).join(" "),
            children: e
          }
        ),
        /* @__PURE__ */ s(
          "button",
          {
            type: "button",
            className: "tc-resize-handle tc-no-drag",
            "aria-label": r,
            title: "Drag to resize. Use arrow keys for precise resizing.",
            onPointerDown: (d) => {
              if (!C.current)
                return;
              d.preventDefault(), d.stopPropagation();
              const f = {
                width: D.width ?? C.current.offsetWidth,
                height: D.height ?? C.current.offsetHeight
              };
              R.current = {
                pointerId: d.pointerId,
                clientX: d.clientX,
                clientY: d.clientY,
                zoom: K,
                ...f
              }, v.current = f, d.currentTarget.setPointerCapture(d.pointerId);
            },
            onPointerMove: (d) => {
              const f = R.current;
              if (!f || f.pointerId !== d.pointerId)
                return;
              d.preventDefault();
              const x = (d.clientX - f.clientX) / f.zoom, W = (d.clientY - f.clientY) / f.zoom;
              if (Z) {
                const oe = W * Z, fe = Math.abs(x) >= Math.abs(oe) ? x : oe;
                _(
                  Ge(
                    f.width + fe,
                    Z,
                    $,
                    G
                  )
                );
                return;
              }
              _({
                width: Math.max($, f.width + x),
                height: Math.max(G, f.height + W)
              });
            },
            onPointerUp: g,
            onPointerCancel: g,
            onKeyDown: (d) => {
              const x = {
                ArrowLeft: [-10, 0],
                ArrowRight: [10, 0],
                ArrowUp: [0, -10],
                ArrowDown: [0, 10]
              }[d.key];
              if (!x || !C.current)
                return;
              d.preventDefault(), d.stopPropagation();
              const W = D.width ?? C.current.offsetWidth, oe = D.height ?? C.current.offsetHeight, fe = Z ? Ge(
                W + (x[0] || x[1] * Z),
                Z,
                $,
                G
              ) : {
                width: Math.max($, W + x[0]),
                height: Math.max(G, oe + x[1])
              };
              _(fe, !0), T == null || T(fe);
            }
          }
        )
      ]
    }
  );
}
const Ar = /* @__PURE__ */ new Set(["eager", "interaction"]);
function Mr(e, t) {
  const r = e ?? (typeof t == "string" && t.trim() ? "interaction" : "eager");
  if (!Ar.has(r))
    throw new TypeError(
      `Frame loadStrategy must be "eager" or "interaction"; received "${r}".`
    );
  if (r === "interaction" && (typeof t != "string" || !t.trim()))
    throw new TypeError(
      'Frame loadStrategy="interaction" requires a non-empty snapshot.'
    );
  return r;
}
function Rr({ loadStrategy: e, snapshot: t }) {
  const r = Mr(e, t), [n, o] = O(
    () => r === "eager"
  );
  de(() => {
    r === "eager" && o(!0);
  }, [r]);
  const a = be(() => {
    o(!0);
  }, []);
  return {
    loadStrategy: r,
    shouldMountIframe: r === "eager" || n,
    activate: a
  };
}
function ze(e, t) {
  if (typeof e != "string" && !(e instanceof URL))
    throw new TypeError("Frame route must be a string or URL.");
  const r = new URL(t), n = new URL(e, r);
  if (n.origin !== r.origin)
    throw new TypeError("Frame route must resolve to the current origin.");
  return n;
}
function gt(e, t, r = "prod") {
  if (e === void 0)
    return [];
  const n = Array.isArray(e) ? e : [e];
  for (const o of n)
    if (!o || typeof o != "object" || typeof o.value != "string" || typeof o.visible != "boolean" || o.external !== void 0 && typeof o.external != "boolean" || o.env !== void 0 && o.env !== "dev" && o.env !== "prod")
      throw new TypeError(
        `Frame ${t} entries must contain a string value, boolean visible, optional boolean external, and optional dev or prod env.`
      );
  return n.filter((o) => !o.env || o.env === r);
}
function _e({ prepend: e, append: t, apend: r, environment: n = "prod" } = {}) {
  if (t !== void 0 && r !== void 0)
    throw new TypeError("Frame cannot receive both append and legacy apend.");
  return {
    prepend: gt(e, "prepend", n),
    append: gt(t ?? r, "append", n)
  };
}
function rt(e) {
  return e.value.startsWith("?") || e.value.startsWith("/?");
}
function Ct(e) {
  return e.value.slice(e.value.startsWith("/?") ? 2 : 1);
}
function Be(e, t = () => !0) {
  return e.filter((r) => !rt(r) && t(r)).map((r) => r.value).join("");
}
function Dr(e, t, r = !1) {
  for (const n of t) {
    if (!rt(n) || r && !n.visible)
      continue;
    const o = new URLSearchParams(Ct(n));
    for (const [a, l] of o)
      e.searchParams.set(a, l);
  }
}
function Ft(e, t, r = !1) {
  const n = (l) => !r || l.visible, o = Be(t.prepend, n), a = Be(t.append, n);
  return e.pathname = `${o}${e.pathname}${a}`, Dr(
    e,
    [...t.prepend, ...t.append],
    r
  ), e;
}
function nt(e) {
  return `${e.pathname}${e.search}${e.hash}`;
}
function Ht(e) {
  return e === "urlstate" || e.startsWith("state.");
}
function Bt(e) {
  for (const t of [...e.searchParams.keys()])
    Ht(t) && e.searchParams.delete(t);
  return e;
}
function Cr(e) {
  const t = String(e), r = t.indexOf("#"), n = r === -1 ? t : t.slice(0, r), o = r === -1 ? "" : t.slice(r), a = n.indexOf("?");
  if (a === -1)
    return t;
  const l = n.slice(0, a), i = new URLSearchParams(n.slice(a + 1));
  for (const y of [...i.keys()])
    Ht(y) && i.delete(y);
  const p = i.toString();
  return `${l}${p ? `?${p}` : ""}${o}`;
}
function Pe(e, t, r, n = (o) => o.visible) {
  const o = Be(t);
  if (!o || !(r === "start" ? e.startsWith(o) : e.endsWith(o)))
    return e;
  const l = Be(t, n), i = r === "start" ? `${l}${e.slice(o.length)}` : `${e.slice(0, -o.length)}${l}`;
  return i.startsWith("/") ? i : `/${i}`;
}
function Pt(e, t, r = (n) => !n.visible) {
  for (const n of t) {
    if (!rt(n) || !r(n))
      continue;
    const o = new URLSearchParams(Ct(n));
    for (const [a, l] of o)
      e.searchParams.get(a) === l && e.searchParams.delete(a);
  }
}
function Fr(e, t = {}, r = window.location.href) {
  const n = _e(t);
  if (![...n.prepend, ...n.append].some((a) => a.visible))
    return Cr(e);
  const o = ze(e, r);
  return nt(
    Bt(Ft(o, n, !0))
  );
}
function Hr(e, t = window.location.href, r = {}) {
  const n = Ft(
    ze(e, t),
    _e(r)
  );
  return n.searchParams.set("embedView", "1"), nt(n);
}
function Br(e, t = {}, r = window.location.href) {
  const n = _e(t), o = ze(e, r);
  return o.pathname = Pe(
    Pe(o.pathname, n.prepend, "start"),
    n.append,
    "end"
  ), Pt(o, [
    ...n.prepend,
    ...n.append
  ]), o.searchParams.delete("embedView"), nt(Bt(o));
}
function wt(e, t = window.location.href, r = {}) {
  const n = ze(e, t), o = _e(r), a = (l) => l.external !== !1;
  return n.pathname = Pe(
    Pe(
      n.pathname,
      o.prepend,
      "start",
      a
    ),
    o.append,
    "end",
    a
  ), Pt(
    n,
    [...o.prepend, ...o.append],
    (l) => l.external === !1
  ), n.searchParams.delete("embedView"), n.href;
}
const Wt = 24, Ut = 900;
function Pr(e) {
  return e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
}
function Wr(e, t, r = 0, n = Wt) {
  if (!Number.isFinite(r))
    throw new TypeError("Frame offset must be a finite number.");
  return Math.max(
    0,
    t.getBoundingClientRect().top + e.scrollY - n + r
  );
}
function Ur(e, t, r = Ut) {
  const n = e.scrollY, o = t - n;
  let a = 0, l = !1, i;
  const p = new Promise((w) => {
    i = w;
  }), y = () => {
    l || (l = !0, a && e.cancelAnimationFrame(a), i(!1));
  };
  if (Math.abs(o) < 1 || r === 0)
    return e.scrollTo({ top: t }), i(!0), { cancel: y, finished: p };
  const A = e.performance.now(), T = (w) => {
    if (l) return;
    const H = Math.min((w - A) / r, 1);
    e.scrollTo({
      top: n + o * Pr(H)
    }), H < 1 ? a = e.requestAnimationFrame(T) : i(!0);
  };
  return a = e.requestAnimationFrame(T), { cancel: y, finished: p };
}
function Or(e, t, {
  offset: r = 0,
  topOffset: n = Wt,
  duration: o = Ut
} = {}) {
  var i;
  const a = e == null ? void 0 : e.contentWindow, l = (i = e == null ? void 0 : e.contentDocument) == null ? void 0 : i.getElementById(t);
  return !a || !l ? null : Ur(
    a,
    Wr(a, l, r, n),
    o
  );
}
const zr = 320, _r = 240, jr = 1270, qr = 776;
function Ot({
  route: e,
  title: t,
  description: r,
  prepend: n,
  append: o,
  apend: a,
  loadStrategy: l,
  snapshot: i,
  snapshotDark: p,
  interactLabel: y = "Click to interact",
  element: A,
  offset: T = 0,
  width: w,
  height: H,
  minWidth: z = zr,
  minHeight: Y = _r,
  onSizeChange: J,
  onSizeCommit: ne,
  persistSize: b,
  id: N,
  blockId: I,
  selected: $,
  onSelectionChange: G,
  className: Z,
  style: we,
  ...Q
}) {
  const C = re(null), R = et(We), v = re(null), B = re(null), V = re(null), K = re(!1), D = fr(), P = { prepend: n, append: o, apend: a, environment: D }, _ = `${String(
    e
  )}
${t}
${D}
${JSON.stringify(n)}
${JSON.stringify(
    o ?? a
  )}`, g = Ke(
    () => Hr(e, window.location.href, P),
    [a, o, D, n, e]
  ), d = Ke(
    () => ({
      sourceKey: _,
      title: t,
      route: Fr(e, P),
      href: wt(g, window.location.href, P)
    }),
    [a, o, D, g, n, e, _, t]
  ), [f, x] = O(d), [W, oe] = O(!1), [fe, ye] = O(null), [Ee, ve] = O(!1), [pe, Ne] = O(!1), [u, k] = O(!1), [M, U] = O(!1), [le, ce] = O(0), [F, ae] = O("idle"), [c, h] = O(!1), j = re(null), q = re(null), {
    loadStrategy: ie,
    shouldMountIframe: S,
    activate: se
  } = Rr({ loadStrategy: l, snapshot: i }), E = f.sourceKey === _ ? f : d, $e = ie === "interaction", Te = fe === g, Le = !!i && !Te;
  de(() => {
    ve(!1);
  }, [i]), de(() => {
    $e && (R && I && R.selectedBlockId !== I || $ === !1) && oe(!1);
  }, [I, R, R == null ? void 0 : R.selectedBlockId, $, $e]), de(() => {
    !W && K.current && V.current && (K.current = !1, V.current.focus());
  }, [W]), de(
    () => () => {
      var m, L;
      (m = v.current) == null || m.call(v), (L = B.current) == null || L.call(B), window.clearTimeout(j.current), window.clearTimeout(q.current);
    },
    []
  ), de(() => {
    if (!u) return;
    const m = (ee) => {
      ee.key === "Alt" && Ne(ee.altKey);
    }, L = () => Ne(!1);
    return window.addEventListener("keydown", m), window.addEventListener("keyup", m), window.addEventListener("blur", L), () => {
      window.removeEventListener("keydown", m), window.removeEventListener("keyup", m), window.removeEventListener("blur", L);
    };
  }, [u]);
  const Zt = be(async () => {
    if (i)
      try {
        const L = await (await fetch(i)).blob();
        await navigator.clipboard.write([
          new window.ClipboardItem({ [L.type]: L })
        ]), U(!0);
      } catch (m) {
        console.error(
          `Unable to copy Frame "${E.title}" thumbnail:`,
          m
        ), U(!1);
      }
  }, [i]), ot = be((m = !1) => {
    K.current = m, oe(!1);
  }, []), Vt = be(() => {
    se(), oe(!0);
  }, [se]), Xt = be(() => {
    var m;
    (m = v.current) == null || m.call(v), ye(null), x(d), se(), ce((L) => L + 1);
  }, [se, d]), Gt = be(async () => {
    const m = I ?? N;
    if (!m) return;
    const L = new URL(window.location.href);
    L.searchParams.delete("tcFrame");
    const ee = L.hash.indexOf("?"), te = ee === -1 ? L.hash : L.hash.slice(0, ee), me = new URLSearchParams(
      ee === -1 ? "" : L.hash.slice(ee + 1)
    );
    me.set("tcFrame", m), L.hash = `${te || "#/"}?${me.toString()}`;
    try {
      await It(L.href), h(!0), window.clearTimeout(q.current), q.current = window.setTimeout(
        () => h(!1),
        1600
      );
    } catch {
      h(!1);
    }
  }, [I, N]), Kt = be(async () => {
    var L, ee;
    const m = C.current;
    if (!((L = navigator.clipboard) != null && L.write) || !window.ClipboardItem || (Le ? !i : !Te)) {
      ae("error");
      return;
    }
    ae("capturing");
    try {
      let te;
      if (Le && i) {
        const xe = ((ee = window.matchMedia) == null ? void 0 : ee.call(
          window,
          "(prefers-color-scheme: dark)"
        ).matches) && p ? p : i, he = await fetch(xe);
        if (!he.ok)
          throw new Error("Unable to load the frame thumbnail.");
        te = await he.blob();
      } else {
        const me = m.contentWindow, xe = m.contentDocument, he = m.clientWidth, ge = m.clientHeight;
        if (!me || !xe || he === 0 || ge === 0)
          throw new Error("Frame is not ready to capture.");
        const { domToBlob: Re } = await import("./index-BDk96P-Z.js");
        te = await Re(xe.documentElement, {
          backgroundColor: null,
          features: { restoreScrollPosition: !0 },
          height: ge,
          scale: window.devicePixelRatio || 1,
          timeout: 3e4,
          width: he,
          style: {
            height: `${ge}px`,
            overflow: "hidden",
            width: `${he}px`
          }
        });
      }
      await navigator.clipboard.write([
        new window.ClipboardItem({ [te.type || "image/png"]: te })
      ]), ae("copied"), window.clearTimeout(j.current), j.current = window.setTimeout(
        () => ae("idle"),
        1600
      );
    } catch (te) {
      console.error(`Unable to capture Frame "${E.title}":`, te), ae("error");
    }
  }, [
    E.title,
    Te,
    Le,
    i,
    p
  ]), ke = () => {
    var L, ee;
    const m = C.current;
    try {
      const te = m.contentWindow.location.href;
      x({
        sourceKey: _,
        title: ((ee = (L = m.contentDocument) == null ? void 0 : L.title) == null ? void 0 : ee.trim()) || t,
        route: Br(
          te,
          P,
          window.location.href
        ),
        href: wt(
          te,
          window.location.href,
          P
        )
      });
    } catch {
    }
  }, Jt = () => {
    var L, ee;
    (L = v.current) == null || L.call(v), ke();
    const m = C.current;
    try {
      const te = m.contentWindow, me = m.contentDocument, xe = me.querySelector("title") || me.head, he = xe ? new MutationObserver(ke) : null, ge = te.history, Re = ge.pushState, at = ge.replaceState, it = (ue) => function(...tr) {
        const rr = ue.apply(this, tr);
        return ke(), rr;
      }, ct = it(Re), st = it(at), lt = (ue) => {
        if (!ue.ctrlKey && !ue.metaKey || !(R != null && R.zoomByWheel))
          return;
        ue.preventDefault(), ue.stopPropagation();
        const je = m.getBoundingClientRect();
        R.zoomByWheel(
          ue.deltaY,
          je.left + ue.clientX,
          je.top + ue.clientY
        );
      }, ut = (ue) => {
        ue.key === "Escape" && ot(!0);
      };
      ge.pushState = ct, ge.replaceState = st, he == null || he.observe(xe, {
        childList: !0,
        subtree: !0,
        characterData: !0
      }), te.addEventListener("hashchange", ke), te.addEventListener("popstate", ke), (ee = te.navigation) == null || ee.addEventListener(
        "currententrychange",
        ke
      ), me.addEventListener("wheel", lt, {
        capture: !0,
        passive: !1
      }), me.addEventListener("keydown", ut), v.current = () => {
        var ue;
        he == null || he.disconnect(), ge.pushState === ct && (ge.pushState = Re), ge.replaceState === st && (ge.replaceState = at), te.removeEventListener("hashchange", ke), te.removeEventListener("popstate", ke), (ue = te.navigation) == null || ue.removeEventListener(
          "currententrychange",
          ke
        ), me.removeEventListener("wheel", lt, !0), me.removeEventListener("keydown", ut);
      };
    } catch {
      v.current = null;
    }
  }, Qt = $e && (!W || !Te), Se = $e && S && !Te, er = typeof y == "string" ? `${y} with ${E.title}` : `Interact with ${E.title}`;
  return /* @__PURE__ */ X(nr, { children: [
    /* @__PURE__ */ s(
      Oe,
      {
        ...Q,
        id: N,
        blockId: I,
        selected: $,
        componentName: "Frame",
        resizeLabel: `Resize ${E.title}`,
        defaultWidth: jr,
        defaultHeight: qr,
        width: w,
        height: H,
        minWidth: z,
        minHeight: Y,
        onSizeChange: J,
        onSizeCommit: ne,
        persistSize: b,
        className: ["tc-frame-block", Z].filter(Boolean).join(" "),
        style: we,
        onSelectionChange: (m) => {
          m || ot(), G == null || G(m);
        },
        children: /* @__PURE__ */ X("section", { className: "tc-frame", children: [
          /* @__PURE__ */ X("div", { className: "tc-frame-title-bar", children: [
            /* @__PURE__ */ X("span", { className: "tc-frame-heading", children: [
              /* @__PURE__ */ s("span", { className: "tc-frame-title", children: E.title }),
              r ? /* @__PURE__ */ s("span", { className: "tc-frame-description", children: r }) : null
            ] }),
            /* @__PURE__ */ s("span", { className: "tc-frame-route", children: E.route }),
            /* @__PURE__ */ X("span", { className: "tc-frame-actions", children: [
              /* @__PURE__ */ s(
                "button",
                {
                  type: "button",
                  className: "tc-frame-action tc-no-drag",
                  onClick: Gt,
                  disabled: !I && !N,
                  "aria-label": c ? `Copied link to ${E.title}` : `Copy link to ${E.title}`,
                  title: c ? "Link copied" : "Copy link to frame",
                  children: c ? /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ s(
                    "path",
                    {
                      d: "m3 8.5 3 3 7-7",
                      fill: "none",
                      stroke: "currentColor",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: "1.5"
                    }
                  ) }) : /* @__PURE__ */ X("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: [
                    /* @__PURE__ */ s(
                      "rect",
                      {
                        x: "5.5",
                        y: "5.5",
                        width: "8",
                        height: "8",
                        rx: "1",
                        fill: "none",
                        stroke: "currentColor",
                        strokeWidth: "1.5"
                      }
                    ),
                    /* @__PURE__ */ s(
                      "path",
                      {
                        d: "M3.5 10.5h-1v-8h8v1",
                        fill: "none",
                        stroke: "currentColor",
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                        strokeWidth: "1.5"
                      }
                    )
                  ] })
                }
              ),
              /* @__PURE__ */ s(
                "button",
                {
                  type: "button",
                  className: "tc-frame-action tc-no-drag",
                  onClick: Xt,
                  "aria-label": `Refresh ${E.title}`,
                  title: "Refresh frame",
                  children: /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ s(
                    "path",
                    {
                      d: "M13.5 3v3.5H10M13 6.5A5.5 5.5 0 1 0 13.1 10",
                      fill: "none",
                      stroke: "currentColor",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: "1.5"
                    }
                  ) })
                }
              ),
              /* @__PURE__ */ s(
                "button",
                {
                  type: "button",
                  className: "tc-frame-action tc-no-drag",
                  onClick: Kt,
                  disabled: (Le ? !i : !Te) || F === "capturing",
                  "aria-label": F === "copied" ? `Copied ${E.title} frame` : F === "error" ? `Could not capture ${E.title} frame` : `Capture ${E.title} frame`,
                  title: Le ? "Copy thumbnail to clipboard" : F === "copied" ? "Copied to clipboard" : F === "error" ? "Capture failed" : "Capture frame to clipboard",
                  children: F === "copied" ? /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ s(
                    "path",
                    {
                      d: "m3 8.5 3 3 7-7",
                      fill: "none",
                      stroke: "currentColor",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: "1.5"
                    }
                  ) }) : /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ s(
                    "path",
                    {
                      d: "M5 4.5 6 3h4l1 1.5h1.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1H5Zm3 6a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
                      fill: "none",
                      stroke: "currentColor",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: "1.5"
                    }
                  ) })
                }
              ),
              /* @__PURE__ */ s(
                "a",
                {
                  className: "tc-frame-action tc-no-drag",
                  href: E.href,
                  target: "_blank",
                  rel: "noreferrer",
                  "aria-label": `Open ${E.title} in new tab`,
                  title: "Open in new tab",
                  children: /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ s(
                    "path",
                    {
                      d: "M9.5 2.5h4v4m0-4-6 6M7 4.5H3.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9",
                      fill: "none",
                      stroke: "currentColor",
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: "1.5"
                    }
                  ) })
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ X("div", { className: "tc-frame-viewport", children: [
            S ? /* @__PURE__ */ s(
              "iframe",
              {
                ref: C,
                className: "tc-frame-document",
                src: g,
                title: E.title,
                onLoad: (m) => {
                  var L;
                  if (ye(g), Jt(), (L = B.current) == null || L.call(B), B.current = null, A) {
                    const ee = Or(
                      m.currentTarget,
                      A,
                      { offset: T }
                    );
                    ee ? B.current = ee.cancel : console.warn(
                      `Unable to scroll Frame "${E.title}" to element "${A}".`
                    );
                  }
                }
              },
              le
            ) : null,
            Le ? /* @__PURE__ */ X(
              "div",
              {
                className: "tc-frame-poster",
                "data-loading": S || void 0,
                children: [
                  Ee ? /* @__PURE__ */ s("div", { className: "tc-frame-snapshot-fallback", "aria-hidden": "true", children: "Preview unavailable" }) : /* @__PURE__ */ X("picture", { className: "tc-frame-snapshot-picture", children: [
                    p ? /* @__PURE__ */ s(
                      "source",
                      {
                        media: "(prefers-color-scheme: dark)",
                        srcSet: p
                      }
                    ) : null,
                    /* @__PURE__ */ s(
                      "img",
                      {
                        src: i,
                        alt: "",
                        draggable: "false",
                        className: "tc-frame-snapshot",
                        onError: () => ve(!0)
                      }
                    )
                  ] }),
                  S && !$e ? /* @__PURE__ */ X("span", { className: "tc-frame-loading-status", role: "status", children: [
                    "Loading ",
                    E.title,
                    "…"
                  ] }) : null
                ]
              }
            ) : null,
            Qt ? /* @__PURE__ */ s(
              "div",
              {
                className: "tc-frame-interaction-guard",
                "data-loading": Se || void 0,
                onClick: (m) => {
                  if (!Se && pe && i) {
                    m.preventDefault(), m.stopPropagation(), Zt();
                    return;
                  }
                  Vt();
                },
                onMouseEnter: () => k(!0),
                onMouseLeave: () => {
                  k(!1), Ne(!1), U(!1);
                },
                children: /* @__PURE__ */ s(
                  "button",
                  {
                    ref: V,
                    type: "button",
                    className: "tc-frame-interact-button tc-no-drag",
                    "aria-label": Se ? `Loading ${E.title}` : M ? `Copied ${E.title} to clipboard` : pe && i ? `Copy ${E.title} to clipboard` : er,
                    "aria-busy": Se || void 0,
                    disabled: Se,
                    children: Se ? "Loading…" : M ? "Copied!" : pe && i ? "Copy to clipboard" : y
                  }
                )
              }
            ) : null
          ] })
        ] })
      }
    ),
    F === "copied" ? ir(
      /* @__PURE__ */ s("div", { className: "tc-frame-capture-toast", role: "status", children: "screenshot copied" }),
      document.body
    ) : null
  ] });
}
Ot.displayName = "Frame";
const en = Ie(Ot), Yr = {
  a: ({ node: e, ...t }) => /* @__PURE__ */ s("a", { ...t, target: "_blank", rel: "noopener noreferrer" })
};
function zt({ children: e, className: t }) {
  if (typeof e != "string")
    throw new TypeError("Markdown content must be a string.");
  return /* @__PURE__ */ s("div", { className: t, children: /* @__PURE__ */ s(cr, { components: Yr, children: e }) });
}
const Zr = /* @__PURE__ */ new Set([
  "yellow",
  "blue",
  "green",
  "pink",
  "purple",
  "orange"
]);
function _t({
  children: e,
  text: t,
  color: r = "yellow",
  width: n,
  height: o,
  minWidth: a = 180,
  minHeight: l = 60,
  onSizeChange: i,
  onSizeCommit: p,
  persistSize: y,
  className: A,
  ...T
}) {
  if (!Zr.has(r))
    throw new TypeError(`Unknown Note color: "${r}".`);
  const w = t ?? e ?? "";
  return /* @__PURE__ */ s(
    Oe,
    {
      ...T,
      componentName: "Note",
      resizeLabel: "Resize note",
      defaultWidth: 270,
      defaultHeight: 170,
      width: n,
      height: o,
      minWidth: a,
      minHeight: l,
      onSizeChange: i,
      onSizeCommit: p,
      persistSize: y,
      className: ["tc-note-block", A].filter(Boolean).join(" "),
      children: /* @__PURE__ */ s("article", { className: "tc-note", "data-color": r, children: /* @__PURE__ */ s(zt, { className: "tc-note-content", children: w }) })
    }
  );
}
_t.displayName = "Note";
const tn = Ie(_t);
function jt({
  children: e,
  content: t,
  width: r,
  height: n,
  minWidth: o = 200,
  minHeight: a = 60,
  onSizeChange: l,
  onSizeCommit: i,
  persistSize: p,
  className: y,
  ...A
}) {
  const T = t ?? e ?? "";
  return /* @__PURE__ */ s(
    Oe,
    {
      ...A,
      componentName: "Mark",
      resizeLabel: "Resize markdown",
      defaultWidth: 530,
      width: r,
      height: n,
      minWidth: o,
      minHeight: a,
      onSizeChange: l,
      onSizeCommit: i,
      persistSize: p,
      className: ["tc-mark-block", y].filter(Boolean).join(" "),
      children: /* @__PURE__ */ s("article", { className: "tc-mark", children: /* @__PURE__ */ s(zt, { className: "tc-mark-content", children: T }) })
    }
  );
}
jt.displayName = "Mark";
const rn = Ie(jt);
function Vr(e) {
  let t;
  try {
    t = e instanceof URL ? e : new URL(e);
  } catch {
    throw new TypeError("Link url must be a valid absolute URL.");
  }
  if (t.protocol !== "http:" && t.protocol !== "https:")
    throw new TypeError("Link url must use HTTP or HTTPS.");
  return {
    href: t.href,
    faviconHref: new URL("/favicon.ico", t.origin).href
  };
}
function yt(e, t) {
  if (typeof e != "string" || e.trim() === "")
    throw new TypeError(`Link ${t} must be a non-empty string.`);
  return e;
}
function bt(e, t) {
  if (e !== void 0) {
    if (!Number.isFinite(e) || e <= 0)
      throw new TypeError(`Link ${t} must be a positive finite number.`);
    return e;
  }
}
function qt({
  url: e,
  title: t,
  displayUrl: r,
  width: n,
  height: o,
  className: a,
  style: l,
  ...i
}) {
  const { href: p, faviconHref: y } = Vr(e), A = yt(t, "title"), T = yt(r, "displayUrl");
  return /* @__PURE__ */ s(
    Dt,
    {
      ...i,
      className: ["tc-link-block", a].filter(Boolean).join(" "),
      style: {
        ...l,
        width: bt(n, "width") ?? 320,
        ...o === void 0 ? {} : { height: bt(o, "height") }
      },
      children: /* @__PURE__ */ X("article", { className: "tc-link", children: [
        /* @__PURE__ */ X("div", { className: "tc-link-favicon", "aria-hidden": "true", children: [
          /* @__PURE__ */ s("svg", { viewBox: "0 0 16 16", focusable: "false", children: /* @__PURE__ */ s(
            "path",
            {
              fill: "currentColor",
              d: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 6H11a11.8 11.8 0 0 0-.8-3.4A5 5 0 0 1 12.9 7ZM8 3c.5 0 1.2 1.5 1.4 4H6.6C6.8 4.5 7.5 3 8 3ZM5.8 3.6A11.8 11.8 0 0 0 5 7H3.1a5 5 0 0 1 2.7-3.4ZM3.1 9H5c.1 1.3.4 2.5.8 3.4A5 5 0 0 1 3.1 9ZM8 13c-.5 0-1.2-1.5-1.4-4h2.8c-.2 2.5-.9 4-1.4 4Zm2.2-.6c.4-.9.7-2.1.8-3.4h1.9a5 5 0 0 1-2.7 3.4Z"
            }
          ) }),
          /* @__PURE__ */ s(
            "img",
            {
              src: y,
              alt: "",
              width: "32",
              height: "32",
              loading: "lazy",
              referrerPolicy: "no-referrer",
              onError: (w) => {
                w.currentTarget.style.display = "none";
              }
            }
          )
        ] }),
        /* @__PURE__ */ X("div", { className: "tc-link-body", children: [
          /* @__PURE__ */ s(
            "a",
            {
              href: p,
              target: "_blank",
              rel: "noopener noreferrer",
              className: "tc-link-title tc-no-drag",
              onPointerDown: (w) => w.stopPropagation(),
              children: A
            }
          ),
          /* @__PURE__ */ s("span", { className: "tc-link-url", children: T })
        ] })
      ] })
    }
  );
}
qt.displayName = "Link";
const nn = Ie(qt), vt = 400, kt = 300;
function Yt({
  src: e,
  alt: t = "",
  width: r,
  height: n,
  minWidth: o = 100,
  minHeight: a = 60,
  loading: l = "lazy",
  decoding: i = "async",
  onLoad: p,
  onError: y,
  onSizeChange: A,
  onSizeCommit: T,
  persistSize: w,
  className: H,
  ...z
}) {
  if (typeof e != "string" || e.trim() === "")
    throw new TypeError("Image src must be a non-empty string.");
  if (typeof t != "string")
    throw new TypeError("Image alt must be a string.");
  const Y = r ?? vt, J = n ?? kt, [ne, b] = O(null), N = ne ?? Y / J;
  return /* @__PURE__ */ s(
    Oe,
    {
      ...z,
      componentName: "Image",
      resizeLabel: t ? `Resize image: ${t}` : "Resize image",
      defaultWidth: vt,
      defaultHeight: kt,
      width: r,
      height: n,
      minWidth: o,
      minHeight: a,
      aspectRatio: N,
      onSizeChange: A,
      onSizeCommit: T,
      persistSize: w,
      className: ["tc-image-block", H].filter(Boolean).join(" "),
      children: /* @__PURE__ */ s("figure", { className: "tc-image", children: /* @__PURE__ */ s(
        "img",
        {
          src: e,
          alt: t,
          loading: l,
          decoding: i,
          draggable: !1,
          onLoad: (I) => {
            const $ = I.currentTarget;
            $.naturalWidth && $.naturalHeight && b($.naturalWidth / $.naturalHeight), p == null || p(I);
          },
          onError: y
        }
      ) })
    }
  );
}
Yt.displayName = "Image";
const on = Ie(Yt);
export {
  Dt as B,
  Qr as C,
  en as F,
  on as I,
  nn as L,
  zt as M,
  tn as N,
  wt as a,
  Hr as b,
  Fr as c,
  rn as d,
  Or as s,
  mr as u
};
