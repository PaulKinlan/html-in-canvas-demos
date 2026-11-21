// DomItem: a Qt Quick item that shows a real DOM element. The element is a child of the
// <canvas> that Qt Quick renders into. Qt lays the item out and draws it from a texture that
// the browser fills with texElementSubImage2D; the browser keeps handling its input.
#pragma once
#include <QQuickItem>
#include <QSGTexture>

class DomItem : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QString name READ name WRITE setName NOTIFY nameChanged)
    Q_PROPERTY(QString value READ value NOTIFY valueChanged)
public:
    explicit DomItem(QQuickItem *parent = nullptr);
    ~DomItem() override;
    QString name() const { return m_name; }
    void setName(const QString &name);
    QString value() const;
    void domChanged(); // called when the browser repainted the element or its value changed

signals:
    void nameChanged();
    void valueChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *node, UpdatePaintNodeData *) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;
    void itemChange(ItemChange change, const ItemChangeData &data) override;

private:
    void upload(); // runs on QQuickWindow::beforeRendering with the WebGL context current
    void relayout();
    QString m_name;
    unsigned m_texture = 0;
    QSize m_textureSize;
    bool m_textureIsNew = false;
    bool m_dirty = true;
    QSGTexture *m_wrapped = nullptr;
};
