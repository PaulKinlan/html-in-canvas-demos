#include "domwidget.h"
#include <QPainter>
#include <QHash>
#include <emscripten.h>

// ---------------------------------------------------------------------------------------
// The browser side. A Qt Widgets window is painted by Qt's raster engine into an image,
// and Qt copies ("flushes") the changed part of that image to a 2D canvas with putImageData().

// #region adopt
// Move the element into the canvas of the Qt window and wrap that canvas's putImageData().
EM_JS(void, dom_adopt, (const char *namePtr), {
    const name = UTF8ToString(namePtr);
    const dom = globalThis.__qtwDom ??= { items: {}, canvas: null, ctx: null, stats: { flushes: 0, draws: 0, paints: 0, error: "" } };
    const el = document.querySelector(`[data-qtw="${name}"]`);
    if (!el) return;
    dom.items[name] = { el, rect: null };
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "touchstart", "touchend", "keydown", "keyup", "beforeinput", "input", "wheel", "contextmenu"])
        el.addEventListener(type, (event) => event.stopPropagation());   // Qt listens on its window element
});

EM_JS(int, dom_attach, (), {
    const dom = globalThis.__qtwDom;
    if (!dom) return 0;
    if (dom.canvas) return 1;
    // Qt puts its windows in a shadow root, on a child element of the container it was given.
    const host = globalThis.__qtwContainer;
    const root = host?.querySelector("#qt-shadow-container")?.shadowRoot ?? host?.shadowRoot;
    const canvas = root?.querySelector("canvas.qt-window-canvas");
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");                 // the context Qt already made
    if (!ctx?.drawElementImage) { dom.stats.error = "the Qt window's canvas has no 2D context with drawElementImage()"; return 0; }
    dom.canvas = canvas;
    dom.ctx = ctx;
    canvas.setAttribute("content", "drawable");
    canvas.setAttribute("layoutsubtree", "");
    for (const item of Object.values(dom.items)) {
        item.el.setAttribute("drawable", "");
        item.el.style.position = "absolute";
        item.el.style.left = item.el.style.top = "0";
        canvas.append(item.el);
    }
    // #region flush
    // After every flush from Qt, draw the elements over the pixels Qt just wrote.
    dom.redraw = () => {
        const scale = canvas.width / (canvas.clientWidth || 1);
        for (const item of Object.values(dom.items)) {
            const r = item.rect;
            if (!r || r.cw <= 0 || r.ch <= 0) continue;   // scrolled out of view or hidden
            ctx.save();
            try {
                ctx.setTransform(scale, 0, 0, scale, 0, 0);
                ctx.beginPath();
                ctx.rect(r.x + r.cx, r.y + r.cy, r.cw, r.ch);   // the part Qt's scroll area shows
                ctx.clip();
                ctx.globalAlpha = r.opacity;
                ctx.drawElementImage(item.el, r.x, r.y, r.w, r.h);
                dom.stats.draws++;
                dom.stats.error = "";
            } catch (e) {
                dom.stats.error = e.name + ": " + e.message;   // no paint record yet
                canvas.requestPaint?.();
            }
            ctx.restore();
        }
    };
    const putImageData = ctx.putImageData;
    ctx.putImageData = function (...args) {
        putImageData.apply(this, args);
        dom.stats.flushes++;
        dom.redraw();
    };
    // #endregion flush
    // The browser repainted an element (typing, focus ring, caret). Ask Qt to repaint the
    // widget under it, which ends in a flush and a redraw of the element.
    canvas.addEventListener("paint", (event) => {
        dom.stats.paints++;
        const changed = event.changedElements ? new Set(event.changedElements) : null;
        for (const [name, item] of Object.entries(dom.items))
            if (!changed || changed.has(item.el)) Module._qtw_changed(stringToUTF8OnStack(name));
    });
    canvas.requestPaint?.();
    return 1;
});
// #endregion adopt

// Give the element the widget's width. Only on a real resize: a width that changes back and
// forth makes the browser repaint the element every frame.
EM_JS(void, dom_set_width, (const char *namePtr, int width), {
    const item = globalThis.__qtwDom?.items[UTF8ToString(namePtr)];
    const px = width + "px";
    if (item && item.el.style.width !== px) item.el.style.width = px;
});

EM_JS(int, dom_height, (const char *namePtr), {
    return globalThis.__qtwDom?.items[UTF8ToString(namePtr)]?.el.offsetHeight || 30;
});

// #region place
// Where the widget is in the window, in CSS px, and the part of it that is visible.
EM_JS(void, dom_place, (const char *namePtr, int x, int y, int w, int h, int cx, int cy, int cw, int ch, double opacity), {
    const item = globalThis.__qtwDom?.items[UTF8ToString(namePtr)];
    if (!item) return;
    item.rect = { x, y, w, h, cx, cy, cw, ch, opacity };
    // An element that is not drawn keeps its last hit box. inert takes it out of hit testing and focus.
    const hidden = cw <= 0 || ch <= 0;
    if (item.el.inert !== hidden) item.el.inert = hidden;
});
// #endregion place

// ---------------------------------------------------------------------------------------
// The Qt side.

static QHash<QByteArray, DomWidget *> g_widgets;

extern "C" EMSCRIPTEN_KEEPALIVE void qtw_changed(const char *name) { DomWidget::changed(name); }

void DomWidget::changed(const char *name)
{
    DomWidget *w = g_widgets.value(name);
    if (!w) return;
    if (dom_height(name) != w->height()) w->updateGeometry();   // the element grew or shrank
    w->update();
}

// #region widget
DomWidget::DomWidget(const QString &name, QWidget *parent) : QWidget(parent), m_name(name.toUtf8())
{
    QSizePolicy policy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    policy.setHeightForWidth(true);
    setSizePolicy(policy);
    g_widgets.insert(m_name, this);
    dom_adopt(m_name.constData());
}

// Layout goes both ways: Qt's layout gives the width, the browser's layout answers with the height.
void DomWidget::resizeEvent(QResizeEvent *)
{
    dom_set_width(m_name.constData(), width());
    if (dom_height(m_name.constData()) != height()) updateGeometry();
    sync();
}

int DomWidget::heightForWidth(int) const
{
    return dom_height(m_name.constData());
}

void DomWidget::sync()
{
    if (!window()->isVisible() || !dom_attach()) return;
    const QPoint origin = mapTo(window(), QPoint(0, 0));
    const QRect visible = isVisible() ? visibleRegion().boundingRect() : QRect();   // empty when scrolled out
    dom_place(m_name.constData(), origin.x(), origin.y(), width(), height(),
              visible.x(), visible.y(), visible.width(), visible.height(), m_opacity);
}

// Qt paints only the background. The flush that follows this paint draws the element.
void DomWidget::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    painter.fillRect(rect(), palette().window());
    sync();
}
// #endregion widget
