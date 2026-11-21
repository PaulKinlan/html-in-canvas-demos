#pragma once
#include <QWidget>

// A widget that reserves the place of a DOM element <… data-qtw="name">. Qt paints the
// background. The page draws the element over it with drawElementImage() after Qt's flush.
class DomWidget : public QWidget
{
    Q_OBJECT
public:
    explicit DomWidget(const QString &name, QWidget *parent = nullptr);
    bool hasHeightForWidth() const override { return true; }
    int heightForWidth(int width) const override;
    QSize sizeHint() const override { return QSize(200, heightForWidth(width())); }
    void setElementOpacity(qreal opacity) { m_opacity = opacity; sync(); update(); }
    static void changed(const char *name);     // the browser repainted the element
public slots:
    void sync();                               // report this widget's rectangle to the page
protected:
    void paintEvent(QPaintEvent *) override;
    void resizeEvent(QResizeEvent *) override;
    void moveEvent(QMoveEvent *) override { sync(); }
    void showEvent(QShowEvent *) override { sync(); }
    void hideEvent(QHideEvent *) override { sync(); }
private:
    QByteArray m_name;
    qreal m_opacity = 1.0;
};
