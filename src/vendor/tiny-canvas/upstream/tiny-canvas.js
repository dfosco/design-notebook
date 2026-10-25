import { b as he, a as xe, c as ge, s as Ie, M as be } from "./Image-Dv6N7c_d.js";
import { B as Xe, C as Ye, F as _e, I as Be, L as Ke, d as qe, N as ze, u as je } from "./Image-Dv6N7c_d.js";
import { jsxs as u, jsx as o, Fragment as Se } from "react/jsx-runtime";
import { useState as M, useRef as L, useMemo as we, useCallback as N, useEffect as v } from "react";
function ye(e, i) {
  const l = Number(e);
  return !Number.isFinite(l) || i <= 0 ? 0 : Math.min(Math.max(Math.trunc(l), 0), i - 1);
}
function ve(e, i) {
  const l = Number(e);
  if (!(!Number.isFinite(l) || l <= 0 || l > i))
    return Math.trunc(l);
}
function Ne(e) {
  var i;
  return e.slides.length + ((i = e.conclusion) != null && i.trim() ? 1 : 0);
}
function G(e, i = 0, l) {
  var D;
  if (!e || !Array.isArray(e.slides) || e.slides.length === 0)
    throw new TypeError("Slides requires a deck with at least one slide.");
  const m = Ne(e), a = ye(i, m), c = !!((D = e.conclusion) != null && D.trim()) && a === e.slides.length, I = Math.min(
    a,
    e.slides.length - 1
  ), x = e.slides[I], p = c ? [] : x.steps ?? [], b = ve(l, p.length);
  let A = x.url;
  for (let S = 0; S < (b ?? 0); S += 1) {
    const g = p[S];
    (g == null ? void 0 : g.type) === "click" && (A = g.url);
  }
  return {
    count: m,
    conclusion: c,
    contentSlideIndex: I,
    slideIndex: a,
    slide: x,
    steps: p,
    stepIndex: b,
    activeStep: b ? p[b - 1] : void 0,
    url: A
  };
}
function Ce(e, i, l, m = !0) {
  const a = G(e, i, l), c = (a.stepIndex ?? 0) + 1;
  return m && c <= a.steps.length ? { slideIndex: a.slideIndex, stepIndex: c } : {
    slideIndex: Math.min(a.slideIndex + 1, a.count - 1),
    stepIndex: void 0
  };
}
function Ee(e, i) {
  const l = G(e, i);
  return {
    slideIndex: Math.max(l.slideIndex - 1, 0),
    stepIndex: void 0
  };
}
function Z(e, i = window.location.href) {
  return he(e, i);
}
function Te(e, i = window.location.href) {
  return xe(
    Z(e, i),
    i
  );
}
function Pe(e, i, l = window.location.href) {
  return i === e.url && e.displayUrl ? e.displayUrl : ge(i, {}, l);
}
const Re = 1e3, $e = 180;
function Fe(e) {
  return e instanceof HTMLElement && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable);
}
function V(e, i, l) {
  const [m, a] = M(i), c = e !== void 0, I = c ? e : m, x = N(
    (p) => {
      c || a(p), l == null || l(p);
    },
    [c, l]
  );
  return [I, x];
}
function Le(e) {
  e.dispatchEvent(new HashChangeEvent("hashchange")), e.dispatchEvent(new PopStateEvent("popstate"));
}
function Oe({
  deck: e,
  slideIndex: i,
  stepIndex: l,
  defaultSlideIndex: m = 0,
  defaultStepIndex: a,
  onSlideChange: c,
  onStepChange: I,
  stepsEnabled: x,
  defaultStepsEnabled: p = !0,
  onStepsEnabledChange: b,
  className: A,
  style: D
}) {
  var ne, se;
  const [S, g] = V(
    i,
    m,
    c
  ), [J, w] = V(
    l,
    a,
    I
  ), [f, re] = V(
    x,
    p,
    b
  ), [r, le] = M(null), [U, Q] = M(null), [C, oe] = M(!1), [O, ae] = M({ x: 0, y: 0 }), H = L(null), E = L(null), T = L(null), k = L(null), X = L(null), t = we(
    () => G(e, S, J),
    [S, J, e]
  ), P = Z(t.url), ce = Z(t.slide.url), de = Te(t.url), ue = Pe(t.slide, t.url), Y = ((ne = e.title) == null ? void 0 : ne.trim()) || "Slides", pe = ((se = e.conclusionTitle) == null ? void 0 : se.trim()) || "Finished", _ = t.conclusion ? pe : t.slide.title, B = t.slideIndex === 0, K = t.slideIndex === t.count - 1, W = f && (t.stepIndex ?? 0) < t.steps.length, y = N(() => {
    var n, s;
    (n = E.current) == null || n.call(E), E.current = null, (s = T.current) == null || s.call(T), T.current = null, k.current && (window.clearTimeout(k.current), k.current = null), Q(null);
  }, []), h = N(
    (n) => {
      y(), w(void 0), g(n);
    },
    [y, g, w]
  ), q = N(() => {
    const n = Ce(
      e,
      t.slideIndex,
      t.stepIndex,
      f
    );
    n.slideIndex !== t.slideIndex ? h(n.slideIndex) : w(n.stepIndex);
  }, [
    e,
    w,
    h,
    f,
    t.slideIndex,
    t.stepIndex
  ]), z = N(() => {
    if (B) return;
    const n = Ee(e, t.slideIndex);
    h(n.slideIndex);
  }, [e, B, h, t.slideIndex]), ee = N(() => {
    K || h(t.slideIndex + 1);
  }, [K, h, t.slideIndex]);
  v(() => {
    const n = (s) => {
      if (Fe(s.target) || !s.metaKey || s.altKey)
        return;
      const d = s.key.toLowerCase();
      d === "k" && s.shiftKey ? (s.preventDefault(), ee()) : d === "k" && !s.shiftKey ? (s.preventDefault(), q()) : d === "j" && !s.shiftKey && (s.preventDefault(), z());
    };
    return window.addEventListener("keydown", n), r == null || r.addEventListener("keydown", n), () => {
      window.removeEventListener("keydown", n), r == null || r.removeEventListener("keydown", n);
    };
  }, [r, q, z, ee]), v(
    () => () => {
      y();
    },
    [y]
  ), v(() => {
    y();
  }, [y, t.slideIndex, t.stepIndex]), v(() => {
    var $;
    if (t.conclusion || !r || (($ = H.current) == null ? void 0 : $.contentWindow) !== r || r.location.href === new URL(P, window.location.href).href)
      return;
    const n = new URL(P, window.location.href);
    if (r.location.origin !== n.origin) {
      r.location.replace(P);
      return;
    }
    const s = {
      left: r.scrollX,
      top: r.scrollY
    };
    r.history.replaceState(null, "", P), Le(r);
    let d = 0;
    const j = r.performance.now() + Re, R = (F) => {
      r.scrollTo(s), F < j && (d = r.requestAnimationFrame(R));
    };
    r.scrollTo(s), d = r.requestAnimationFrame(R), T.current = () => r.cancelAnimationFrame(d);
  }, [P, r, t.conclusion]), v(() => {
    var d;
    if (!f || ((d = t.activeStep) == null ? void 0 : d.type) !== "cursor") return;
    const n = H.current;
    if (!n) return;
    const s = Ie(n, t.activeStep.targetId, {
      offset: t.activeStep.scrollOffset ?? 0
    });
    if (!s) {
      console.warn(
        `Unable to scroll Slides frame to element "${t.activeStep.targetId}".`
      );
      return;
    }
    E.current = s.cancel, s.finished.then((j) => {
      j && (k.current = window.setTimeout(() => {
        var ie;
        const R = (ie = n.contentDocument) == null ? void 0 : ie.getElementById(
          t.activeStep.targetId
        );
        if (!R) return;
        const $ = n.getBoundingClientRect(), F = R.getBoundingClientRect();
        Q({
          x: $.left + Math.max(24, F.left - 24),
          y: $.top + F.top + Math.min(F.height / 2, 24)
        });
      }, $e));
    });
  }, [r, f, t.activeStep]), v(() => {
    !f && t.stepIndex && w(void 0);
  }, [w, f, t.stepIndex]);
  const fe = (n) => {
    n.target instanceof Element && n.target.closest("button, input, a") || (n.currentTarget.setPointerCapture(n.pointerId), X.current = {
      startX: n.clientX,
      startY: n.clientY,
      originX: O.x,
      originY: O.y
    });
  }, me = (n) => {
    const s = X.current;
    s && ae({
      x: s.originX + n.clientX - s.startX,
      y: s.originY + n.clientY - s.startY
    });
  }, te = (n) => {
    X.current = null, n.currentTarget.hasPointerCapture(n.pointerId) && n.currentTarget.releasePointerCapture(n.pointerId);
  };
  return /* @__PURE__ */ u(
    "main",
    {
      className: ["tc-slides", A].filter(Boolean).join(" "),
      style: {
        "--tc-slides-frame-padding": `${t.slide.framePaddingPercent ?? 5}%`,
        ...D
      },
      children: [
        /* @__PURE__ */ u("section", { className: "tc-slides-browser", "aria-label": `${Y}: ${_}`, children: [
          /* @__PURE__ */ u("header", { className: "tc-slides-browser-bar", children: [
            /* @__PURE__ */ u("span", { className: "tc-slides-browser-dots", "aria-hidden": "true", children: [
              /* @__PURE__ */ o("i", {}),
              /* @__PURE__ */ o("i", {}),
              /* @__PURE__ */ o("i", {})
            ] }),
            /* @__PURE__ */ o("span", { className: "tc-slides-browser-route", children: ue }),
            /* @__PURE__ */ o(
              "a",
              {
                className: "tc-slides-icon-button",
                href: de,
                target: "_blank",
                rel: "noreferrer",
                "aria-label": "Open active slide in a new tab",
                title: "Open active slide in a new tab",
                children: "↗"
              }
            )
          ] }),
          /* @__PURE__ */ o("div", { className: "tc-slides-frame-viewport", children: /* @__PURE__ */ o(
            "iframe",
            {
              ref: H,
              className: "tc-slides-frame",
              src: ce,
              title: `${Y}: ${_}`,
              onLoad: (n) => le(n.currentTarget.contentWindow)
            },
            `${e.id}:${t.contentSlideIndex}`
          ) })
        ] }),
        t.conclusion ? /* @__PURE__ */ o("div", { className: "tc-slides-conclusion-scrim", "aria-hidden": "true" }) : null,
        !t.conclusion && f && U ? /* @__PURE__ */ o(
          "div",
          {
            className: "tc-slides-cursor",
            style: { left: U.x, top: U.y },
            "aria-hidden": "true"
          }
        ) : null,
        /* @__PURE__ */ u(
          "aside",
          {
            className: "tc-slides-panel",
            "data-collapsed": C || void 0,
            style: {
              transform: `translate3d(${O.x}px, ${O.y}px, 0)`
            },
            "aria-label": `${Y}, slide ${t.slideIndex + 1} of ${t.count}`,
            children: [
              /* @__PURE__ */ u(
                "header",
                {
                  className: "tc-slides-panel-header",
                  onPointerDown: fe,
                  onPointerMove: me,
                  onPointerUp: te,
                  onPointerCancel: te,
                  children: [
                    /* @__PURE__ */ o("span", { className: "tc-slides-grabber", "aria-hidden": "true", children: "⠿" }),
                    /* @__PURE__ */ o("strong", { children: _ }),
                    !t.conclusion && !C ? /* @__PURE__ */ u("label", { className: "tc-slides-steps-toggle", children: [
                      /* @__PURE__ */ o(
                        "input",
                        {
                          type: "checkbox",
                          checked: f,
                          onChange: (n) => re(n.currentTarget.checked)
                        }
                      ),
                      /* @__PURE__ */ o("span", { children: "Steps" })
                    ] }) : null,
                    /* @__PURE__ */ o(
                      "button",
                      {
                        type: "button",
                        className: "tc-slides-icon-button",
                        "aria-label": C ? "Expand slides panel" : "Collapse slides panel",
                        onClick: () => oe((n) => !n),
                        children: C ? "⌃" : "⌄"
                      }
                    )
                  ]
                }
              ),
              C ? null : /* @__PURE__ */ u("div", { className: "tc-slides-panel-body", children: [
                t.conclusion ? /* @__PURE__ */ o(be, { className: "tc-slides-conclusion", children: e.conclusion }) : /* @__PURE__ */ u(Se, { children: [
                  /* @__PURE__ */ o("div", { className: "tc-slides-progress", "aria-label": "Slide progress", children: Array.from({ length: t.count }, (n, s) => /* @__PURE__ */ o(
                    "button",
                    {
                      type: "button",
                      "data-active": s === t.slideIndex || void 0,
                      "data-complete": s < t.slideIndex || void 0,
                      "aria-label": `Go to slide ${s + 1}`,
                      onClick: () => h(s)
                    },
                    s
                  )) }),
                  /* @__PURE__ */ o("p", { children: t.slide.description })
                ] }),
                /* @__PURE__ */ u("div", { className: "tc-slides-actions", children: [
                  /* @__PURE__ */ o("button", { type: "button", disabled: B, onClick: z, children: "Previous" }),
                  t.conclusion ? /* @__PURE__ */ o("button", { type: "button", onClick: () => h(0), children: "Restart" }) : /* @__PURE__ */ o(
                    "button",
                    {
                      type: "button",
                      disabled: K && !W,
                      onClick: q,
                      children: W ? "Next step" : "Next"
                    }
                  )
                ] })
              ] })
            ]
          }
        )
      ]
    }
  );
}
function ke(e) {
  const i = String(e).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (!i)
    throw new TypeError(
      "Tiny Canvas page filenames must contain a letter or number."
    );
  return i;
}
export {
  Xe as Block,
  Ye as Canvas,
  _e as Frame,
  Be as Image,
  Ke as Link,
  qe as Mark,
  ze as Note,
  Oe as Slides,
  Pe as buildSlidesDisplayRoute,
  Z as buildSlidesFrameHref,
  Te as buildSlidesOpenHref,
  Ce as nextSlidesState,
  ye as normalizeSlidesIndex,
  ve as normalizeSlidesStep,
  Ee as previousSlidesState,
  G as resolveSlidesState,
  Ne as slidesCount,
  ke as slugifyCanvasPageName,
  je as useResetCanvas
};
