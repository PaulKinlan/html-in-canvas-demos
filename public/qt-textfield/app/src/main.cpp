#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QVariant>
#include <emscripten.h>
#include <cstdlib>
#include <cstring>

static QObject *g_root = nullptr;

// The page reads the QML side through these two calls. Main.qml answers both.
extern "C" EMSCRIPTEN_KEEPALIVE char *qttf_probe()
{
    QVariant result;
    if (g_root) QMetaObject::invokeMethod(g_root, "probe", Q_RETURN_ARG(QVariant, result));
    return strdup(result.toString().toUtf8().constData());
}

extern "C" EMSCRIPTEN_KEEPALIVE void qttf_command(const char *name, const char *arg)
{
    if (g_root) QMetaObject::invokeMethod(g_root, "command", Q_ARG(QVariant, QString::fromUtf8(name)), Q_ARG(QVariant, QString::fromUtf8(arg)));
}

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    QQmlApplicationEngine engine;
    engine.loadFromModule("QtTf", "Main");
    if (!engine.rootObjects().isEmpty()) g_root = engine.rootObjects().first();
    return app.exec();
}
