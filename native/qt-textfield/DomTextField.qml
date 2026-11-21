// #region domtextfield
// A text field that looks like the Basic style's TextField. Qt draws the background and the
// focus border. The text, caret and selection are a real <input data-qt="name">, drawn by DomItem.
import QtQuick
import QtQuick.Controls
import QtTf

Item {
    id: control
    property alias name: dom.name
    property alias text: dom.text            // two-way: QML can read it and assign to it
    readonly property bool domFocus: dom.domFocus
    readonly property alias domItem: dom
    implicitWidth: 200
    implicitHeight: 40                       // the Basic TextField's background height

    Rectangle {                              // copied from QtQuick/Controls/Basic/TextField.qml
        anchors.fill: parent
        border.width: dom.domFocus ? 2 : 1
        color: control.palette.base
        border.color: dom.domFocus ? control.palette.highlight : control.palette.mid
    }
    DomItem {
        id: dom
        anchors.fill: parent
        anchors.margins: 2                   // inside the border; the element's own padding is 8px
    }
}
// #endregion domtextfield
