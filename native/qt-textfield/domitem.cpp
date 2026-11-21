#include "domitem.h"
#include <QQuickWindow>
#include <QSGSimpleTextureNode>
#include <QOpenGLContext>
#include <QOpenGLExtraFunctions>
#include <emscripten.h>

// ---------------------------------------------------------------------------------------
// The browser side. GLctx is Emscripten's current WebGL2 context: the one Qt Quick draws with.

// #region adopt
// Move the element <… data-qt="name"> into Qt's canvas and make both drawable.
EM_JS(void, dom_adopt, (const char *namePtr, int id), {
    const name = UTF8ToString(namePtr);
    const canvas = GLctx.canvas;
    if (!globalThis.__qtTf) globalThis.__qtTf = { items: {}, stats: { paints: 0, uploads: 0, places: 0, helperFocusStopped: 0, error: "" } };
    const dom = globalThis.__qtTf;
    const el = dom.items[name]?.el ?? document.querySelector(`[data-qt="${name}"]`);
    if (!el) return;
    if (!canvas.__qtTf) {
        canvas.__qtTf = true;
        dom.canvas = canvas;
        canvas.setAttribute("content", "drawable");
        canvas.setAttribute("layoutsubtree", "");
        canvas.addEventListener("paint", () => { dom.stats.paints++; Module._qttf_changed(); });
        // #region helper
        // Qt 6.10 moves browser focus to a hidden "focus helper" element whenever a Qt item that
        // takes no text gets Qt's active focus. That would blur the real input the moment the
        // DomItem takes active focus. While a DomItem has it, the helper's focus() does nothing.
        const helper = canvas.parentNode.querySelector(".qt-window-focus-helper");
        if (helper) {
            const focus = helper.focus.bind(helper);
            helper.focus = (...args) => { if (dom.hold) dom.stats.helperFocusStopped++; else focus(...args); };
        }
        // #endregion helper
        // The page reads and drives the QML side through these.
        dom.probe = () => { const p = Module._qttf_probe(); const text = UTF8ToString(p); Module._free(p); return JSON.parse(text || "{}"); };
        dom.command = (command, arg = "") => {
            const a = stringToNewUTF8(String(command)), b = stringToNewUTF8(String(arg));
            Module._qttf_command(a, b);
            Module._free(a); Module._free(b);
        };
    }
    el.setAttribute("drawable", "");
    el.style.position = "absolute";
    el.style.left = el.style.top = "0";
    canvas.append(el);
    // Qt listens for input on its window element. Events the browser gave to the real
    // element stop here, so Qt does not also handle them.
    for (const type of ["pointerdown", "pointerup", "pointermove", "pointercancel", "mousedown", "mouseup", "touchstart", "touchend", "touchmove", "keydown", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "wheel", "contextmenu", "copy", "cut", "paste"])
        el.addEventListener(type, (event) => event.stopPropagation());
    el.addEventListener("input", () => Module._qttf_changed());
    el.addEventListener("change", () => Module._qttf_changed());
    // Focus, blur and Tab go to the item, so QML can show the focus look and move focus on.
    el.addEventListener("focus", () => Module._qttf_event(id, 1, 0));
    el.addEventListener("blur", () => Module._qttf_event(id, 2, 0));
    el.addEventListener("keydown", (event) => {
        if (event.key !== "Tab" || event.isComposing || dom.nativeTab) return;
        event.preventDefault();
        Module._qttf_event(id, 3, event.shiftKey ? 1 : 0);
    });
    dom.items[name] = { el, key: "", id };
    canvas.requestPaint?.();
});
// #endregion adopt

EM_JS(void, dom_layout, (const char *namePtr, double width, double height), {
    const item = globalThis.__qtTf?.items[UTF8ToString(namePtr)];
    if (!item) return;
    const w = Math.round(width) + "px", h = Math.round(height) + "px";
    if (item.el.style.width !== w) item.el.style.width = w;
    if (item.el.style.height !== h) item.el.style.height = h;
});

// Size of the element's image in texels, packed as width * 65536 + height. 0 before the first paint.
EM_JS(int, dom_image_size, (const char *namePtr), {
    const item = globalThis.__qtTf?.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        const size = GLctx.canvas.getElementImageDefaultSize(item.el);
        return Math.ceil(size.width) * 65536 + Math.ceil(size.height);
    } catch (e) {
        GLctx.canvas.requestPaint?.();
        return 0;
    }
});

// #region upload
// Copy the element into the texture that C++ has bound to TEXTURE_2D.
EM_JS(int, dom_upload, (const char *namePtr), {
    const item = globalThis.__qtTf?.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // Qt Quick textures are premultiplied
        GLctx.texElementSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, item.el);
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        __qtTf.stats.uploads++;
        return 1;
    } catch (e) {
        __qtTf.stats.error = String(e);
        return 0;
    }
});
// #endregion upload

// #region place
// Tell the browser where Qt Quick drew the item: a 2D matrix from element px to canvas CSS px.
// The caret, the selection handles, the IME candidate window and the autofill popup are all
// placed by the browser from this box.
EM_JS(void, dom_place, (const char *namePtr, double a, double b, double c, double d, double e, double f, int shown), {
    const item = globalThis.__qtTf?.items[UTF8ToString(namePtr)];
    if (!item) return;
    const canvas = GLctx.canvas;
    const key = shown ? [a, b, c, d, e, f].map((v) => Math.round(v * 100)).join() : "hidden";
    if (item.key === key) return;
    item.key = key;
    // canvasTransform is in CSS px on some canvases and buffer px on others: measure once.
    if (!canvas.__qtTfUnit && item.el.offsetWidth) {
        canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix() });
        const measured = item.el.getBoundingClientRect().width;
        if (measured > 0) canvas.__qtTfUnit = item.el.offsetWidth / measured;
    }
    const unit = canvas.__qtTfUnit || 1;
    const m = shown ? new DOMMatrix([a, b, c, d, e, f]) : new DOMMatrix().translate(-100000, -100000);
    canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix().scale(unit).multiply(m) });
    canvas.toggleAttribute("data-geometry-tick"); // drops Chromium's cached hit-test results
    __qtTf.stats.places++;
});
// #endregion place

// #region value
EM_JS(char *, dom_value, (const char *namePtr), {
    const name = UTF8ToString(namePtr);
    const el = globalThis.__qtTf?.items[name]?.el ?? document.querySelector(`[data-qt="${name}"]`);
    return stringToNewUTF8(el ? String(el.value) : "");
});

EM_JS(void, dom_set_value, (const char *namePtr, const char *textPtr), {
    const name = UTF8ToString(namePtr), text = UTF8ToString(textPtr);
    const el = globalThis.__qtTf?.items[name]?.el ?? document.querySelector(`[data-qt="${name}"]`);
    if (el && el.value !== text) el.value = text; // the browser repaints the element and fires paint
});

EM_JS(void, dom_focus, (const char *namePtr), {
    // preventScroll: the element's box is where Qt drew it, and the person is already looking at it.
    globalThis.__qtTf?.items[UTF8ToString(namePtr)]?.el.focus({ preventScroll: true });
});

EM_JS(void, dom_hold, (int on), { if (globalThis.__qtTf) globalThis.__qtTf.hold = !!on; });
// #endregion value

// ---------------------------------------------------------------------------------------

static QList<DomItem *> g_items;
static int g_nextId = 1;

extern "C" EMSCRIPTEN_KEEPALIVE void qttf_changed()
{
    for (DomItem *item : std::as_const(g_items))
        item->domChanged();
}

extern "C" EMSCRIPTEN_KEEPALIVE void qttf_event(int id, int kind, int arg)
{
    for (DomItem *item : std::as_const(g_items))
        if (item->id() == id) { item->domEvent(kind, arg); return; }
}

DomItem::DomItem(QQuickItem *parent) : QQuickItem(parent)
{
    setFlag(ItemHasContents);
    setActiveFocusOnTab(true);
    m_id = g_nextId++;
    g_items.append(this);
}

DomItem::~DomItem() { g_items.removeAll(this); }

void DomItem::setName(const QString &name)
{
    if (name == m_name) return;
    m_name = name;
    emit nameChanged();
    update();
}

// #region binding
// QML writes `text`: set the element's value. The element changes: read its value and notify.
void DomItem::setText(const QString &text)
{
    if (text == m_text) return;
    m_text = text;
    dom_set_value(m_name.toUtf8().constData(), text.toUtf8().constData());
    emit textChanged();
}

void DomItem::domChanged()
{
    m_dirty = true;
    char *raw = dom_value(m_name.toUtf8().constData());
    const QString now = QString::fromUtf8(raw);
    free(raw);
    if (now != m_text) {
        m_text = now;
        emit textChanged();
    }
    update();
}

void DomItem::domEvent(int kind, int arg)
{
    if (kind == 1 || kind == 2) {            // focus or blur on the element
        m_domFocus = kind == 1;
        emit domFocusChanged();
        // Give the item Qt's active focus too, so a Qt TextField that had it drops its caret.
        if (m_domFocus && !hasActiveFocus()) forceActiveFocus(Qt::MouseFocusReason);
    } else if (kind == 3) {                  // Tab or Shift+Tab pressed in the element
        if (QQuickItem *next = nextItemInFocusChain(!arg))
            next->forceActiveFocus(arg ? Qt::BacktabFocusReason : Qt::TabFocusReason);
    }
}

// Qt's Tab reached this item: focus the element.
void DomItem::focusInEvent(QFocusEvent *event)
{
    QQuickItem::focusInEvent(event);
    dom_hold(1); // see the "helper" region above
    if (event->reason() == Qt::TabFocusReason || event->reason() == Qt::BacktabFocusReason || event->reason() == Qt::OtherFocusReason)
        dom_focus(m_name.toUtf8().constData());
}

void DomItem::focusOutEvent(QFocusEvent *event)
{
    QQuickItem::focusOutEvent(event);
    dom_hold(0);
}
// #endregion binding

void DomItem::relayout()
{
    // Qt picks the size. The element fills the item.
    if (width() > 0 && height() > 0) dom_layout(m_name.toUtf8().constData(), width(), height());
}

void DomItem::geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry)
{
    QQuickItem::geometryChange(newGeometry, oldGeometry);
    relayout();
    update();
}

void DomItem::itemChange(ItemChange change, const ItemChangeData &data)
{
    QQuickItem::itemChange(change, data);
    if (change == ItemSceneChange && data.window) {
        // Raw GL is only safe at this point of Qt Quick's frame.
        connect(data.window, &QQuickWindow::beforeRendering, this, &DomItem::upload, Qt::DirectConnection);
        // Parents can move without this item changing: place again every frame.
        connect(data.window, &QQuickWindow::beforeSynchronizing, this, [this] {
            bool ok = false;
            const QTransform t = itemTransform(nullptr, &ok); // item px -> window px, which are CSS px
            dom_place(m_name.toUtf8().constData(), t.m11(), t.m12(), t.m21(), t.m22(), t.dx(), t.dy(), ok && isVisible() && opacity() > 0);
        }, Qt::DirectConnection);
    }
}

// #region qt-upload
void DomItem::upload()
{
    if (m_name.isEmpty() || !QOpenGLContext::currentContext()) return;
    const QByteArray name = m_name.toUtf8();
    if (!property("adopted").toBool()) {
        dom_adopt(name.constData(), m_id); // needs the canvas, which exists once Qt has a GL context
        setProperty("adopted", true);
        QMetaObject::invokeMethod(this, [this] { relayout(); domChanged(); }, Qt::QueuedConnection);
    }
    const int packed = dom_image_size(name.constData());
    if (!packed) return; // the browser has not painted the element yet
    const QSize size(packed >> 16, packed & 0xffff);

    auto *gl = QOpenGLContext::currentContext()->extraFunctions();
    window()->beginExternalCommands();
    GLint previous = 0; // Qt's renderer caches its bindings: put back what was bound
    gl->glGetIntegerv(GL_TEXTURE_BINDING_2D, &previous);
    if (!m_texture || size != m_textureSize) {
        if (m_texture) gl->glDeleteTextures(1, &m_texture);
        gl->glGenTextures(1, &m_texture);
        gl->glBindTexture(GL_TEXTURE_2D, m_texture);
        gl->glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, size.width(), size.height());
        gl->glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        gl->glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        gl->glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        gl->glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        m_textureSize = size;
        m_textureIsNew = true;
        m_dirty = true;
        QMetaObject::invokeMethod(this, &QQuickItem::update, Qt::QueuedConnection);
    }
    if (m_dirty) {
        gl->glBindTexture(GL_TEXTURE_2D, m_texture);
        if (dom_upload(name.constData())) m_dirty = false; // gl.texElementSubImage2D(…, element)
    }
    gl->glBindTexture(GL_TEXTURE_2D, previous);
    window()->endExternalCommands();
}

QSGNode *DomItem::updatePaintNode(QSGNode *old, UpdatePaintNodeData *)
{
    auto *node = static_cast<QSGSimpleTextureNode *>(old);
    if (!m_texture) { // nothing uploaded yet: try again next frame
        update();
        return node;
    }
    if (!node) {
        node = new QSGSimpleTextureNode;
        node->setFiltering(QSGTexture::Linear);
        m_textureIsNew = true;
    }
    if (m_textureIsNew) {
        // Hand the GL texture to the scene graph. It is drawn like any other Qt Quick texture.
        delete m_wrapped;
        m_wrapped = QNativeInterface::QSGOpenGLTexture::fromNative(m_texture, window(), m_textureSize, QQuickWindow::TextureHasAlphaChannel);
        node->setTexture(m_wrapped);
        m_textureIsNew = false;
    }
    node->setRect(boundingRect());
    node->markDirty(QSGNode::DirtyMaterial);
    return node;
}
// #endregion qt-upload
