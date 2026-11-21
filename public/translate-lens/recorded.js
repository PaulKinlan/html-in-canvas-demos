// Translations, rewrites and summaries of the sample text on this page, written
// in advance. The page uses them when the browser has no on-device model, and
// says so under the demo. Keys are the English text with every number replaced
// by "#".
//
// fr, es, de, ja: one entry per text node (the pieces between inline elements).
// simple, summary: one entry per block.

export const RECORDED = {
  'Reading a tide table': {
    fr: 'Lire une table des marées', es: 'Cómo leer una tabla de mareas', de: 'Eine Gezeitentafel lesen', ja: '潮汐表の読み方',
    simple: 'How to read a tide table', summary: 'Reading a tide table',
  },
  'A tide table lists the times of high and low water for one harbour. The heights are measured from': {
    fr: 'Une table des marées indique les heures de pleine mer et de basse mer pour un port. Les hauteurs sont mesurées à partir du',
    es: 'Una tabla de mareas indica las horas de pleamar y bajamar de un puerto. Las alturas se miden desde el',
    de: 'Eine Gezeitentafel nennt die Zeiten von Hoch- und Niedrigwasser für einen Hafen. Die Höhen werden vom',
    ja: '潮汐表には、ある港の満潮と干潮の時刻が載っています。高さは',
  },
  'chart datum': { fr: 'zéro hydrographique', es: 'cero hidrográfico', de: 'Seekartennull', ja: '海図基準面' },
  ', the lowest level the sea is expected to reach.': {
    fr: ', le niveau le plus bas que la mer devrait atteindre.',
    es: ', el nivel más bajo que se espera que alcance el mar.',
    de: ' aus gemessen, dem niedrigsten Stand, den das Meer voraussichtlich erreicht.',
    ja: 'から測ります。これは海面が下がると見込まれる最も低い水位です。',
  },
  'Two high tides arrive each day, about twelve hours and twenty-five minutes apart. At new moon and full moon the range is largest.': {
    fr: 'Deux pleines mers se produisent chaque jour, à environ douze heures et vingt-cinq minutes d\'intervalle. À la nouvelle lune et à la pleine lune, le marnage est le plus grand.',
    es: 'Cada día hay dos pleamares, separadas por unas doce horas y veinticinco minutos. Con luna nueva y luna llena la amplitud es máxima.',
    de: 'Jeden Tag gibt es zwei Hochwasser im Abstand von etwa zwölf Stunden und fünfundzwanzig Minuten. Bei Neumond und Vollmond ist der Tidenhub am größten.',
    ja: '満潮は1日に2回、約12時間25分の間隔で訪れます。新月と満月のころに干満の差が最も大きくなります。',
  },
  'These are spring tides': { fr: 'Ce sont les marées de vive-eau', es: 'Son las mareas vivas', de: 'Das sind Springtiden', ja: 'これが大潮です' },
  '.': { fr: '.', es: '.', de: '.', ja: '。' },
  'High water: #, # metres': { fr: 'Pleine mer : #, # mètres', es: 'Pleamar: #, # metros', de: 'Hochwasser: #, # Meter', ja: '満潮：#、#メートル', simple: 'High water: #, # metres', summary: 'High #, # m' },
  'Low water: #, # metres': { fr: 'Basse mer : #, # mètres', es: 'Bajamar: #, # metros', de: 'Niedrigwasser: #, # Meter', ja: '干潮：#、#メートル', simple: 'Low water: #, # metres', summary: 'Low #, # m' },
  'Edit this sentence to see the copy under the lens change.': {
    fr: 'Modifiez cette phrase pour voir la copie sous la loupe changer.',
    es: 'Edita esta frase para ver cómo cambia la copia bajo la lente.',
    de: 'Bearbeiten Sie diesen Satz, um zu sehen, wie sich die Kopie unter der Linse ändert.',
    ja: 'この文を編集すると、レンズの下のコピーが変わります。',
    simple: 'Change this sentence. The copy under the lens changes too.',
    summary: 'Editable sentence.',
  },
  'Show tomorrow': { fr: 'Afficher demain', es: 'Mostrar mañana', de: 'Morgen anzeigen', ja: '明日を表示', simple: 'Show tomorrow', summary: 'Tomorrow' },
  'Show today': { fr: 'Afficher aujourd\'hui', es: 'Mostrar hoy', de: 'Heute anzeigen', ja: '今日を表示', simple: 'Show today', summary: 'Today' },

  // Whole blocks, for "simpler words" and "summary".
  'A tide table lists the times of high and low water for one harbour. The heights are measured from chart datum, the lowest level the sea is expected to reach.': {
    simple: 'A tide table tells you when the sea will be high and when it will be low at one harbour. Heights are counted up from chart datum. That is about as low as the sea ever gets.',
    summary: 'High and low water times for one harbour, with heights above chart datum.',
  },
  'Two high tides arrive each day, about twelve hours and twenty-five minutes apart. At new moon and full moon the range is largest. These are spring tides.': {
    simple: 'The sea is high twice a day, a bit more than twelve hours apart. The gap between high and low is biggest at new moon and full moon. These are called spring tides.',
    summary: 'Two high tides a day. The range is largest at new and full moon (spring tides).',
  },
};

// Summaries of the three cards in the zoom demo, keyed by card id.
export const CARD_SUMMARIES = {
  'card-tides': 'Tides: two highs a day, largest range at new and full moon.',
  'card-knots': 'Knots: a bowline makes a fixed loop that unties easily.',
  'card-lights': 'Lights: each lighthouse has its own flash pattern.',
};
