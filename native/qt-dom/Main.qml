// #region qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtDom

ApplicationWindow {
    id: root
    visible: true
    title: "Qt Quick with DOM items"
    palette.window: "#1e1f22"; palette.windowText: "#e6e6e6"; palette.base: "#101012"; palette.text: "#e6e6e6"
    palette.button: "#34363b"; palette.buttonText: "#e6e6e6"; palette.highlight: "#41cd52"; palette.placeholderText: "#8a8a8a"

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        ColumnLayout {
            width: Math.min(root.width - 24, 380); x: 12; y: 10; spacing: 6

            Label { text: "Qt Quick Controls and DOM elements"; font.pixelSize: 18; font.bold: true }
            Label { text: "Name (Qt Quick TextField)" }
            TextField { id: nameField; text: "Ada"; Layout.fillWidth: true }

            Label { text: "Email (DOM <input type=email>)" }
            DomItem { id: email; name: "email"; Layout.fillWidth: true
                      opacity: fade.value; rotation: turn.value; transformOrigin: Item.Center }

            Label { text: "Plan (DOM <select>)" }
            DomItem { id: plan; name: "plan"; Layout.fillWidth: true; opacity: fade.value }

            Label { text: "Notes (DOM <textarea>)" }
            DomItem { id: notes; name: "notes"; Layout.fillWidth: true; opacity: fade.value }

            Label { text: "DOM opacity (Qt Quick Slider)" }
            Slider { id: fade; from: 0.2; to: 1; value: 1; Layout.fillWidth: true }
            Label { text: "Rotate the email field (Qt Quick Slider)" }
            Slider { id: turn; from: -20; to: 20; value: 0; Layout.fillWidth: true }

            Button { text: "Submit (Qt Quick Button)"
                     onClicked: result.text = "name=" + nameField.text + " email=" + email.value + " plan=" + plan.value + " notes=" + notes.value }
            Label { id: result; Layout.fillWidth: true; wrapMode: Text.Wrap; font.family: "DejaVu Sans Mono"; font.pixelSize: 12 }
        }
    }
}
// #endregion qml
