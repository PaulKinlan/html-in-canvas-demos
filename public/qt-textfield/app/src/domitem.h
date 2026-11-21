// DomItem: a Qt Quick item that shows a real DOM element. The element is a child of the
// <canvas> that Qt Quick renders into. Qt lays the item out and draws it from a texture that
// the browser fills with texElementSubImage2D; the browser keeps handling its input.
// This copy of native/qt-dom's DomItem adds a two-way `text` property, a `domFocus` property
// and Tab handling, which is what DomTextField.qml needs to stand in for a TextField.
#pragma once
#include <QQuickItem>
#include <QSGTexture>

class DomItem : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QString name READ name WRITE setName NOTIFY nameChanged)
    Q_PROPERTY(QString text READ text WRITE setText NOTIFY textChanged)
    Q_PROPERTY(bool domFocus READ domFocus NOTIFY domFocusChanged)
public:
    explicit DomItem(QQuickItem *parent = nullptr);
    ~DomItem() override;
    QString name() const { return m_name; }
    void setName(const QString &name);
    QString text() const { return m_text; }
    void setText(const QString &text);
    bool domFocus() const { return m_domFocus; }
    void domChanged();                // the browser repainted the element or its value changed
    void domEvent(int kind, int arg); // focus, blur and Tab from the element
    int id() const { return m_id; }

signals:
    void nameChanged();
    void textChanged();
    void domFocusChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *node, UpdatePaintNodeData *) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;
    void itemChange(ItemChange change, const ItemChangeData &data) override;
    void focusInEvent(QFocusEvent *event) override;
    void focusOutEvent(QFocusEvent *event) override;

private:
    void upload(); // runs on QQuickWindow::beforeRendering with the WebGL context current
    void relayout();
    QString m_name;
    QString m_text;
    int m_id = 0;
    bool m_domFocus = false;
    unsigned m_texture = 0;
    QSize m_textureSize;
    bool m_textureIsNew = false;
    bool m_dirty = true;
    QSGTexture *m_wrapped = nullptr;
};
