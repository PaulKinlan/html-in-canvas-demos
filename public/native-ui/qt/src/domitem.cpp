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
EM_JS(void, dom_adopt, (const char *namePtr), {
    const name = UTF8ToString(namePtr);
    const canvas = GLctx.canvas;
    const el = document.querySelector(`[data-qt="${name}"]`);
    if (!el) return;
    globalThis.__qtDom ??= { items: {}, stats: { paints: 0, uploads: 0, places: 0, error: "" } };
    if (!canvas.__qtDom) {
        canvas.__qtDom = true;
        canvas.setAttribute("content", "drawable");
        canvas.setAttribute("layoutsubtree", "");
        canvas.addEventListener("paint", () => { __qtDom.stats.paints++; Module._qtdom_changed(); });
    }
    el.setAttribute("drawable", "");
    el.style.position = "absolute";
    el.style.left = el.style.top = "0";
    canvas.append(el);
    // Qt listens for input on its window element. Events the browser gave to the real
    // element stop here, so Qt does not also handle them.
    for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "touchstart", "keydown", "keyup", "beforeinput", "input", "wheel", "contextmenu"])
        el.addEventListener(type, (event) => event.stopPropagation());
    el.addEventListener("input", () => Module._qtdom_changed());
    el.addEventListener("change", () => Module._qtdom_changed());
    __qtDom.items[name] = { el, key: "" };
    canvas.requestPaint?.();
});
// #endregion adopt

EM_JS(int, dom_layout, (const char *namePtr, double width), {
    const item = globalThis.__qtDom?.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    const px = Math.round(width) + "px";
    if (item.el.style.width !== px) item.el.style.width = px;
    return item.el.offsetHeight;
});

// Size of the element's image in texels, packed as width * 65536 + height. 0 before the first paint.
EM_JS(int, dom_image_size, (const char *namePtr), {
    const item = globalThis.__qtDom?.items[UTF8ToString(namePtr)];
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
    const item = globalThis.__qtDom?.items[UTF8ToString(namePtr)];
    if (!item) return 0;
    try {
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // Qt Quick textures are premultiplied
        GLctx.texElementSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, item.el);
        GLctx.pixelStorei(GLctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        __qtDom.stats.uploads++;
        return 1;
    } catch (e) {
        __qtDom.stats.error = String(e);
        return 0;
    }
});
// #endregion upload

// #region place
// Tell the browser where Qt Quick drew the item: a 2D matrix from element px to canvas CSS px.
EM_JS(void, dom_place, (const char *namePtr, double a, double b, double c, double d, double e, double f, int shown), {
    const item = globalThis.__qtDom?.items[UTF8ToString(namePtr)];
    if (!item) return;
    const canvas = GLctx.canvas;
    const key = shown ? [a, b, c, d, e, f].map((v) => Math.round(v * 100)).join() : "hidden";
    if (item.key === key) return;
    item.key = key;
    // canvasTransform is in CSS px on some canvases and buffer px on others: measure once.
    if (!canvas.__qtDomUnit && item.el.offsetWidth) {
        canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix() });
        const measured = item.el.getBoundingClientRect().width;
        if (measured > 0) canvas.__qtDomUnit = item.el.offsetWidth / measured;
    }
    const unit = canvas.__qtDomUnit || 1;
    const m = shown ? new DOMMatrix([a, b, c, d, e, f]) : new DOMMatrix().translate(-100000, -100000);
    canvas.updateElementGeometry(item.el, { canvasTransform: new DOMMatrix().scale(unit).multiply(m) });
    canvas.toggleAttribute("data-geometry-tick"); // drops Chromium's cached hit-test results
    __qtDom.stats.places++;
});
// #endregion place

EM_JS(char *, dom_value, (const char *namePtr), {
    const el = globalThis.__qtDom?.items[UTF8ToString(namePtr)]?.el;
    const field = el?.matches("input, select, textarea") ? el : el?.querySelector("input, select, textarea");
    return stringToNewUTF8(field ? String(field.value) : "");
});

// ---------------------------------------------------------------------------------------

static QList<DomItem *> g_items;

extern "C" EMSCRIPTEN_KEEPALIVE void qtdom_changed()
{
    for (DomItem *item : std::as_const(g_items))
        item->domChanged();
}

DomItem::DomItem(QQuickItem *parent) : QQuickItem(parent)
{
    setFlag(ItemHasContents);
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

QString DomItem::value() const
{
    char *text = dom_value(m_name.toUtf8().constData());
    const QString result = QString::fromUtf8(text);
    free(text);
    return result;
}

void DomItem::domChanged()
{
    m_dirty = true;
    relayout();
    emit valueChanged();
    update();
}

void DomItem::relayout()
{
    // Qt picks the width, the browser lays the element out and answers with the height.
    if (width() > 0) setImplicitHeight(dom_layout(m_name.toUtf8().constData(), width()));
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
        // Parents can move or rotate without this item changing: place again every frame.
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
        dom_adopt(name.constData()); // needs the canvas, which exists once Qt has a GL context
        setProperty("adopted", true);
        QMetaObject::invokeMethod(this, [this] { relayout(); }, Qt::QueuedConnection);
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
        // Hand the GL texture to the scene graph. It is drawn like any other Qt Quick texture,
        // so opacity, rotation, clipping and z-order come from the scene graph.
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
