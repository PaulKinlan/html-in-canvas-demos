import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtTf

ApplicationWindow {
    id: root
    visible: true
    title: "Qt Quick TextField and DomTextField"
    palette.window: "#1e1f22"; palette.windowText: "#e6e6e6"; palette.base: "#101012"; palette.text: "#e6e6e6"
    palette.button: "#34363b"; palette.buttonText: "#e6e6e6"; palette.highlight: "#41cd52"; palette.highlightedText: "#101012"
    palette.placeholderText: "#8a8a8a"; palette.mid: "#6a6a70"

    // The page reads the scene through probe() and drives it through command().
    function rectOf(item) {
        const p = item.mapToItem(null, 0, 0)
        return { x: p.x, y: p.y, w: item.width, h: item.height }
    }
    function qtFacts(field) {
        const c = field.mapToItem(null, field.cursorRectangle.x, field.cursorRectangle.y)
        return { text: field.text, preedit: field.preeditText, displayText: field.displayText, activeFocus: field.activeFocus,
                 cursor: field.cursorPosition, selected: field.selectedText, rect: rectOf(field),
                 cursorRect: { x: c.x, y: c.y, w: field.cursorRectangle.width, h: field.cursorRectangle.height },
                 composing: field.inputMethodComposing, hints: field.inputMethodHints }
    }
    function domFacts(field) {
        return { text: field.text, domFocus: field.domFocus, activeFocus: field.domItem.activeFocus, rect: rectOf(field.domItem) }
    }
    function probe() {
        return JSON.stringify({
            qt: { email: qtFacts(qtEmail), password: qtFacts(qtPassword), code: qtFacts(qtCode) },
            dom: { email: domFacts(domEmail), password: domFacts(domPassword), code: domFacts(domCode) },
            helloQt: helloQt.text, helloDom: helloDom.text,
            qtButton: qtButton.enabled, domButton: domButton.enabled, result: result.text,
            focusItem: root.activeFocusItem ? String(root.activeFocusItem) : "", width: root.width, height: root.height })
    }
    function command(name, arg) {
        const fields = { qtEmail, qtPassword, qtCode, domEmail, domPassword, domCode }
        const parts = name.split(":")
        const field = fields[parts[1]]
        if (parts[0] === "set" && field) field.text = arg
        else if (parts[0] === "focus" && field) (field.domItem ?? field).forceActiveFocus()
        else if (parts[0] === "click") (parts[1] === "qt" ? qtButton : domButton).clicked()
        else if (parts[0] === "unfocus") root.contentItem.forceActiveFocus()
    }

    // #region qml
    ColumnLayout {
        width: Math.min(root.width - 24, 420); x: 12; y: 8; spacing: 3

        Label { text: "Email" ; font.bold: true }
        Label { text: "Qt TextField"; font.pixelSize: 12; opacity: 0.8 }
        TextField { id: qtEmail; Layout.fillWidth: true; placeholderText: "you@example.com"
                    inputMethodHints: Qt.ImhEmailCharactersOnly | Qt.ImhNoAutoUppercase }
        Label { text: "DomTextField: <input type=email autocomplete=email>"; font.pixelSize: 12; opacity: 0.8 }
        DomTextField { id: domEmail; name: "email"; Layout.fillWidth: true }

        Label { text: "Password"; font.bold: true; Layout.topMargin: 6 }
        Label { text: "Qt TextField, echoMode Password"; font.pixelSize: 12; opacity: 0.8 }
        TextField { id: qtPassword; Layout.fillWidth: true; echoMode: TextInput.Password; placeholderText: "password" }
        Label { text: "DomTextField: <input type=password autocomplete=current-password>"; font.pixelSize: 12; opacity: 0.8
                Layout.fillWidth: true; elide: Text.ElideRight }
        DomTextField { id: domPassword; name: "password"; Layout.fillWidth: true }

        Label { text: "Code from a text message"; font.bold: true; Layout.topMargin: 6 }
        Label { text: "Qt TextField, ImhDigitsOnly"; font.pixelSize: 12; opacity: 0.8 }
        TextField { id: qtCode; Layout.fillWidth: true; placeholderText: "123456"; inputMethodHints: Qt.ImhDigitsOnly }
        Label { text: "DomTextField: <input autocomplete=one-time-code inputmode=numeric>"; font.pixelSize: 12; opacity: 0.8
                Layout.fillWidth: true; elide: Text.ElideRight }
        DomTextField { id: domCode; name: "code"; Layout.fillWidth: true }

        // The rest of the UI reads both kinds of field the same way: through `text`.
        Label { id: helloQt; text: "Hello, " + qtEmail.text; Layout.fillWidth: true; elide: Text.ElideRight; Layout.topMargin: 6 }
        Label { id: helloDom; text: "Hello, " + domEmail.text; Layout.fillWidth: true; elide: Text.ElideRight }
        RowLayout {
            Layout.fillWidth: true
            Button { id: qtButton; text: "Sign in (Qt fields)"; Layout.fillWidth: true
                     enabled: qtEmail.text.length > 0 && qtPassword.text.length > 0
                     onClicked: result.text = "Qt fields: " + qtEmail.text + ", password of " + qtPassword.text.length + ", code " + qtCode.text }
            Button { id: domButton; text: "Sign in (DOM fields)"; Layout.fillWidth: true
                     enabled: domEmail.text.length > 0 && domPassword.text.length > 0
                     onClicked: { result.text = "DOM fields: " + domEmail.text + ", password of " + domPassword.text.length + ", code " + domCode.text
                                  domCode.text = "" } }   // QML writes to the element through the same property
        }
        Label { id: result; Layout.fillWidth: true; elide: Text.ElideRight; font.pixelSize: 12 }
    }
    // #endregion qml
}
