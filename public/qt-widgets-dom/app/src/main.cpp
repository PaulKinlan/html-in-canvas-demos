#include <QApplication>
#include <QComboBox>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QScrollBar>
#include <QScroller>
#include <QSlider>
#include <QStyleFactory>
#include <QVBoxLayout>
#include <emscripten.h>
#include "domwidget.h"

// For the page's live checks.
static QScrollArea *g_window = nullptr;
static QComboBox *g_combo = nullptr;
extern "C" {
EMSCRIPTEN_KEEPALIVE void qtw_scroll(int y) { if (g_window) g_window->verticalScrollBar()->setValue(y); }
EMSCRIPTEN_KEEPALIVE void qtw_popup(int open) { if (g_combo) { if (open) g_combo->showPopup(); else g_combo->hidePopup(); } }
}

// #region app
int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    app.setStyle(QStyleFactory::create("Fusion"));

    auto *content = new QWidget;
    auto *layout = new QVBoxLayout(content);
    layout->addWidget(new QLabel("<b>Painted by Qt</b> (raster engine, QPainter)"));
    layout->addWidget(new QLineEdit("QLineEdit"));
    auto *slider = new QSlider(Qt::Horizontal);
    slider->setRange(20, 100);
    slider->setValue(100);
    layout->addWidget(new QLabel("QSlider: opacity of the DOM elements"));
    layout->addWidget(slider);

    auto *combo = new QComboBox;                        // its popup is a second Qt window, over the fields below
    for (const char *plan : { "Free", "Team", "Enterprise", "Education", "Trial", "Partner", "Internal", "Legacy" })
        combo->addItem(QString("QComboBox: %1").arg(plan));
    layout->addWidget(combo);
    layout->addWidget(new QLabel("<b>DOM elements</b>, drawn after Qt's flush"));
    QList<DomWidget *> doms;
    for (const char *name : { "email", "plan", "notes", "terms" }) {
        auto *dom = new DomWidget(name);
        doms.append(dom);
        layout->addWidget(dom);
        QObject::connect(slider, &QSlider::valueChanged, dom, [dom](int v) { dom->setElementOpacity(v / 100.0); });
    }
    layout->addWidget(new QPushButton("QPushButton"));
    for (int i = 1; i <= 14; i++) layout->addWidget(new QLabel(QString("QLabel row %1, so the area scrolls").arg(i)));

    QScrollArea window;                                 // the top-level window: a scroll area
    window.setWidget(content);
    window.setWidgetResizable(true);
    window.setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    window.setWindowFlag(Qt::FramelessWindowHint);
    // Scrolling moves the content widget, not the DomWidgets inside it, so they are told.
    for (DomWidget *dom : doms)
        QObject::connect(window.verticalScrollBar(), &QScrollBar::valueChanged, dom, &DomWidget::sync);
    // Qt Widgets does not scroll by touch drag unless a QScroller is attached to the viewport.
    QScroller::grabGesture(window.viewport(), QScroller::TouchGesture);
    g_window = &window;
    g_combo = combo;
    window.showMaximized();
    return app.exec();
}
// #endregion app
