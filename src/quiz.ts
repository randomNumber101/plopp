/**
 * Bierquiz: Fragen-Katalog, Auswahl und Speicherung der Antworten.
 *
 * Zwei Fragetypen: Multiple Choice (eine richtige Antwort) und Schätzfragen (Zahl mit Toleranzbereich –
 * wer innerhalb der Toleranz liegt, hat richtig; genau getroffen zählt extra für ein Abzeichen).
 */
import { supabase } from './supabase'

export type QuizCat = 'Geschichte' | 'Brauen' | 'Sorten' | 'Deutschland' | 'Welt' | 'Zahlen' | 'Kurioses' | 'Sprache'

interface Base {
  id: string
  cat: QuizCat
  q: string
  /** kurze Erklärung nach der Antwort */
  fact?: string
}
export interface McQuestion extends Base {
  kind: 'mc'
  options: string[]
  /** Index der richtigen Antwort in options */
  answer: number
}
export interface NumQuestion extends Base {
  kind: 'num'
  answer: number
  /** erlaubte Abweichung (±) */
  tol: number
  unit?: string
}
export type Question = McQuestion | NumQuestion

const mc = (id: string, cat: QuizCat, q: string, options: string[], fact?: string): McQuestion => ({
  id, cat, q, kind: 'mc', options, answer: 0, fact,
})
const num = (id: string, cat: QuizCat, q: string, answer: number, tol: number, unit?: string, fact?: string): NumQuestion => ({
  id, cat, q, kind: 'num', answer, tol, unit, fact,
})

// Die richtige Antwort steht bei Multiple Choice immer zuerst – die App mischt die Reihenfolge.
export const QUESTIONS: Question[] = [
  // ------------------------------------------------------------------ Geschichte
  num('rhg-jahr', 'Geschichte', 'In welchem Jahr wurde das bayerische Reinheitsgebot erlassen?', 1516, 3, undefined,
    'Am 23. April 1516 – deshalb ist der 23. April der Tag des Deutschen Bieres.'),
  mc('rhg-ort', 'Geschichte', 'In welcher Stadt wurde das Reinheitsgebot 1516 erlassen?', ['Ingolstadt', 'München', 'Landshut', 'Regensburg'],
    'Herzog Wilhelm IV. und Ludwig X. erließen es auf dem Landtag in Ingolstadt.'),
  mc('rhg-hefe', 'Geschichte', 'Welche Zutat stand 1516 noch NICHT im Reinheitsgebot?', ['Hefe', 'Hopfen', 'Wasser', 'Gerste'],
    'Hefe war als Mikroorganismus noch unbekannt – sie kam erst später ins Gesetz.'),
  mc('tag-bier', 'Geschichte', 'Wann ist der Tag des Deutschen Bieres?', ['23. April', '1. Mai', '3. Oktober', '11. November']),
  num('weihenstephan', 'Geschichte', 'Seit welchem Jahr wird in Weihenstephan gebraut (laut Brauerei)?', 1040, 25, undefined,
    'Weihenstephan gilt als älteste noch bestehende Brauerei der Welt.'),
  mc('weltenburg', 'Geschichte', 'Welche Brauerei gilt als älteste Klosterbrauerei der Welt?',
    ['Weltenburg', 'Andechs', 'Ettal', 'Scheyern'], 'Im Kloster Weltenburg an der Donau wird seit 1050 gebraut.'),
  num('wiesn-jahr', 'Geschichte', 'In welchem Jahr fand das erste Oktoberfest statt?', 1810, 5, undefined,
    'Anlass war die Hochzeit von Kronprinz Ludwig und Therese von Sachsen-Hildburghausen.'),
  mc('wiesn-anlass', 'Geschichte', 'Was war der Höhepunkt des allerersten Oktoberfests?',
    ['Ein Pferderennen', 'Ein Bierwettbewerb', 'Ein Feuerwerk', 'Ein Schützenumzug'],
    'Bierzelte kamen erst Jahrzehnte später dazu.'),
  mc('sumerer', 'Geschichte', 'Von welchem Volk stammen einige der ältesten schriftlichen Belege fürs Bierbrauen?',
    ['Sumerer', 'Römer', 'Germanen', 'Wikinger'], 'Die Sumerer hatten sogar eine Biergöttin: Ninkasi.'),
  mc('pils-erfinder', 'Geschichte', 'Wer braute 1842 in Pilsen das erste Pils?', ['Josef Groll', 'Gabriel Sedlmayr', 'Anton Dreher', 'Carl von Linde'],
    'Ausgerechnet ein bayerischer Braumeister erfand das böhmische Pils.'),
  num('pils-jahr', 'Geschichte', 'In welchem Jahr wurde in Pilsen das erste Pils gebraut?', 1842, 5),
  mc('pasteur', 'Geschichte', 'Welcher Forscher zeigte, dass Hefe für die Gärung verantwortlich ist?',
    ['Louis Pasteur', 'Robert Koch', 'Isaac Newton', 'Alexander Fleming'], 'Pasteur schrieb sogar ein ganzes Buch über Bier.'),
  mc('linde', 'Geschichte', 'Carl von Linde revolutionierte das Brauen mit …', ['der Kältemaschine', 'dem Kronkorken', 'der Bierdose', 'dem Zapfhahn'],
    'Seine Kältemaschine machte untergäriges Bier das ganze Jahr über möglich.'),
  num('kronkorken-jahr', 'Geschichte', 'In welchem Jahr wurde der Kronkorken patentiert?', 1892, 8, undefined, 'Erfinder: William Painter aus Baltimore.'),
  num('hofbraeuhaus', 'Geschichte', 'In welchem Jahr wurde das Münchner Hofbräuhaus gegründet?', 1589, 10),
  num('dose-jahr', 'Geschichte', 'In welchem Jahr kam das erste Dosenbier in den Handel (USA)?', 1935, 5),
  mc('salvator', 'Geschichte', 'Wer braute den ersten Doppelbock „Salvator“?', ['Paulaner-Mönche', 'Benediktiner', 'Die Stadt München', 'Augustiner-Mönche'],
    'Das starke Fastenbier half den Mönchen durch die Fastenzeit.'),
  mc('einbeck', 'Geschichte', 'Woher hat das Bockbier seinen Namen?', ['Von der Stadt Einbeck', 'Vom Ziegenbock', 'Vom Bockspringen', 'Von „bockig“'],
    '„Ainpöckisch Bier“ wurde in Bayern zu „Bock“ – der Ziegenbock kam erst später aufs Etikett.'),
  mc('hildegard', 'Geschichte', 'Welche berühmte Äbtissin beschrieb schon im 12. Jahrhundert die Wirkung von Hopfen?',
    ['Hildegard von Bingen', 'Elisabeth von Thüringen', 'Katharina von Bora', 'Teresa von Ávila']),
  mc('gruit', 'Geschichte', 'Womit würzte man Bier, bevor sich Hopfen durchsetzte?', ['Gruit – einer Kräutermischung', 'Zimt', 'Salz', 'Pfeffer']),
  mc('gambrinus', 'Geschichte', 'Wer gilt als sagenhafter „König des Bieres“?', ['Gambrinus', 'Bacchus', 'Dionysos', 'Ninkasi'],
    'Ninkasi war übrigens die sumerische Biergöttin.'),
  mc('pyramiden', 'Geschichte', 'Womit wurden Arbeiter beim Pyramidenbau im alten Ägypten unter anderem entlohnt?',
    ['Mit Bier', 'Mit Gold', 'Mit Wein', 'Mit Salz']),
  mc('radler-legende', 'Geschichte', 'Wer soll das Radler der Legende nach erfunden haben?',
    ['Gastwirt Franz Xaver Kugler', 'Der ADAC', 'Ein Pariser Radrennfahrer', 'Die Brauerei Löwenbräu'],
    '1922 sollen ihm bei einem Ansturm von Radlern das Bier ausgegangen sein – also mischte er Zitronenlimo dazu.'),

  // ------------------------------------------------------------------ Brauen & Zutaten
  mc('vier-zutaten', 'Brauen', 'Welche vier Zutaten erlaubt das Reinheitsgebot heute für untergäriges Bier?',
    ['Wasser, Malz, Hopfen, Hefe', 'Wasser, Gerste, Zucker, Hefe', 'Wasser, Malz, Hopfen, Honig', 'Wasser, Weizen, Hopfen, Salz']),
  mc('hopfen-hanf', 'Brauen', 'Mit welcher Pflanze ist Hopfen eng verwandt?', ['Hanf', 'Brennnessel', 'Weinrebe', 'Gerste'],
    'Beide gehören zur Familie der Hanfgewächse.'),
  mc('hopfen-dolde', 'Brauen', 'Welche Teile der Hopfenpflanze kommen ins Bier?', ['Die Dolden der weiblichen Pflanze', 'Die Blätter', 'Die Wurzeln', 'Die männlichen Blüten']),
  mc('hallertau', 'Brauen', 'Wo liegt das größte zusammenhängende Hopfenanbaugebiet der Welt?', ['In der Hallertau', 'Im Elsass', 'In Tettnang', 'In Kent']),
  mc('malz', 'Brauen', 'Was ist Malz?', ['Gekeimtes und getrocknetes Getreide', 'Gerösteter Hopfen', 'Eingedickter Zuckersaft', 'Eine Hefeart']),
  mc('darre', 'Brauen', 'Was passiert auf der „Darre“?', ['Das Malz wird getrocknet', 'Das Bier wird gefiltert', 'Der Hopfen wird geerntet', 'Die Flaschen werden gespült']),
  mc('maische', 'Brauen', 'Wie heißt das Gemisch aus geschrotetem Malz und warmem Wasser?', ['Maische', 'Würze', 'Treber', 'Jungbier']),
  mc('treber', 'Brauen', 'Was passiert meist mit dem Treber, den Malzresten nach dem Läutern?', ['Er wird Viehfutter', 'Er wird zu Hopfen', 'Er kommt ins Bier zurück', 'Er wird verbrannt']),
  mc('wuerze', 'Brauen', 'Was ist die „Würze“ beim Brauen?', ['Die zuckerhaltige Flüssigkeit vor der Gärung', 'Eine Gewürzmischung', 'Der Schaum auf dem Bier', 'Die Hefe nach der Gärung']),
  mc('gaerung', 'Brauen', 'Was macht die Hefe bei der Gärung aus Zucker?', ['Alkohol und Kohlensäure', 'Eiweiß und Wasser', 'Hopfen und Malz', 'Stärke und Säure']),
  mc('untergaerig', 'Brauen', 'Bei welcher Temperatur arbeitet untergärige Hefe typischerweise?', ['Etwa 4–9 °C', 'Etwa 15–25 °C', 'Etwa 30–40 °C', 'Unter 0 °C']),
  mc('obergaerig', 'Brauen', 'Welches dieser Biere ist untergärig?', ['Pils', 'Kölsch', 'Altbier', 'Hefeweizen']),
  mc('stammwuerze', 'Brauen', 'Was gibt die Stammwürze an?', ['Den Anteil gelöster Stoffe in der Würze vor der Gärung', 'Den Alkoholgehalt', 'Die Bitterkeit', 'Das Alter des Biers']),
  mc('ibu', 'Brauen', 'Wofür steht „IBU“?', ['International Bitterness Units', 'Independent Brewers Union', 'Internationale Bier-Union', 'Index of Barley Usage']),
  mc('ebc', 'Brauen', 'Was misst man in EBC-Einheiten?', ['Die Farbe des Biers', 'Die Bitterkeit', 'Den Alkohol', 'Die Kohlensäure']),
  mc('dryhop', 'Brauen', 'Was bedeutet „Hopfenstopfen“ (Dry Hopping)?', ['Hopfen kalt nach dem Kochen zugeben – für mehr Aroma', 'Hopfen trocknen', 'Ohne Hopfen brauen', 'Hopfendolden pressen']),
  mc('zwickel', 'Brauen', 'Woher hat das Zwickelbier seinen Namen?', ['Vom Zwickelhahn am Lagertank', 'Vom Zwicken im Bauch', 'Vom Brauer Zwickl', 'Von der Zwickauer Brauerei'],
    'Über den Zwickelhahn zieht der Braumeister Proben – ungefiltert, wie das Bier.'),
  mc('kristall', 'Brauen', 'Was unterscheidet Kristallweizen vom Hefeweizen?', ['Es ist gefiltert', 'Es hat mehr Alkohol', 'Es ist untergärig', 'Es enthält keinen Weizen']),
  mc('lichtgeschmack', 'Brauen', 'Warum sind die meisten Bierflaschen braun?', ['Sie schützen vor Licht, das den Geschmack verdirbt', 'Braunes Glas ist billiger', 'Tradition aus der Römerzeit', 'Damit man den Füllstand nicht sieht']),
  mc('rauchmalz', 'Brauen', 'Über welchem Holz wird das Malz für Bamberger Rauchbier traditionell gedarrt?', ['Buche', 'Eiche', 'Kiefer', 'Kirsche']),
  mc('gose-zutaten', 'Brauen', 'Was gehört traditionell in eine Gose?', ['Salz und Koriander', 'Honig und Zimt', 'Kaffee und Kakao', 'Chili und Limette']),
  mc('eisbock', 'Brauen', 'Wie wird ein Eisbock stärker gemacht?', ['Durch Ausfrieren von Wasser', 'Durch Zugabe von Schnaps', 'Durch doppeltes Gären', 'Durch Kochen ohne Deckel']),
  mc('lambic', 'Brauen', 'Was ist das Besondere an belgischem Lambic?', ['Spontangärung mit wilden Hefen aus der Luft', 'Es wird ohne Wasser gebraut', 'Es wird mit Wein gemischt', 'Es reift unter Wasser']),
  num('weizen-anteil', 'Brauen', 'Wie viel Prozent Weizenmalz muss ein deutsches Weizenbier mindestens enthalten?', 50, 5, '%'),
  num('wasser-anteil', 'Brauen', 'Zu wie viel Prozent besteht ein normales Bier etwa aus Wasser?', 92, 4, '%'),
  num('bock-stammwuerze', 'Brauen', 'Wie viel Prozent Stammwürze braucht ein Bockbier in Deutschland mindestens?', 16, 1, '%'),

  // ------------------------------------------------------------------ Sorten & Mischungen
  mc('koelsch-stadt', 'Sorten', 'In welcher Stadt ist das Altbier zu Hause?', ['Düsseldorf', 'Köln', 'Dortmund', 'Bonn']),
  mc('koelsch-konvention', 'Sorten', 'Wie heißt die Vereinbarung, die regelt, wo Kölsch gebraut werden darf?', ['Kölsch-Konvention', 'Rheinisches Bierabkommen', 'Domgesetz', 'Kölner Brauordnung']),
  mc('berliner-weisse', 'Sorten', 'Womit trinkt man Berliner Weisse klassisch „mit Schuss“?', ['Himbeer- oder Waldmeistersirup', 'Wodka', 'Zitronensaft', 'Cola']),
  mc('napoleon', 'Sorten', 'Welches Bier soll Napoleons Soldaten als „Champagner des Nordens“ gegolten haben?', ['Berliner Weisse', 'Kölsch', 'Jever', 'Gose']),
  mc('maerzen', 'Sorten', 'Warum heißt das Märzen so?', ['Es wurde im März gebraut, um über den Sommer zu lagern', 'Es wird nur im März getrunken', 'Erfunden von Brauer März', 'Es ist das Bier der Märzrevolution']),
  mc('schwarzbier', 'Sorten', 'Für welches Bier ist Bad Köstritz in Thüringen berühmt?', ['Schwarzbier', 'Rauchbier', 'Weizenbock', 'Gose']),
  mc('export', 'Sorten', 'Aus welcher Stadt stammt das klassische „Export“?', ['Dortmund', 'Hamburg', 'Bremen', 'Kiel']),
  mc('doppelbock-namen', 'Sorten', 'Auf welche Silbe enden viele Doppelbock-Namen?', ['-ator', '-inger', '-bräu', '-ius']),
  mc('ipa', 'Sorten', 'Warum soll das India Pale Ale besonders hopfig sein?', ['Hopfen konservierte es auf der langen Schiffsreise nach Indien', 'In Indien wächst viel Hopfen', 'Für indische Gewürze', 'Weil es aus Reis gebraut wird']),
  mc('porter', 'Sorten', 'Nach wem ist das Porter benannt?', ['Nach Londoner Lastenträgern', 'Nach dem Brauer John Porter', 'Nach der Hafenstadt Porto', 'Nach Türstehern']),
  mc('stout-land', 'Sorten', 'Welches Land verbindet man am stärksten mit Stout?', ['Irland', 'Schottland', 'Belgien', 'Kanada']),
  mc('trappisten', 'Sorten', 'Welches Land hat die meisten Trappistenbrauereien?', ['Belgien', 'Deutschland', 'Frankreich', 'Niederlande']),
  mc('westvleteren', 'Sorten', 'Was ist das Besondere an Westvleteren-Bier?', ['Es wird fast nur direkt am Kloster verkauft', 'Es ist alkoholfrei', 'Es wird nur an Weihnachten gebraut', 'Es reift 10 Jahre']),
  mc('alsterwasser', 'Sorten', 'Wie heißt das Radler in Norddeutschland?', ['Alsterwasser', 'Elbbrause', 'Nordlicht', 'Hafenbier']),
  mc('russ', 'Sorten', 'Was ist eine „Russ“?', ['Weißbier mit Zitronenlimo', 'Pils mit Wodka', 'Dunkles mit Cola', 'Kölsch mit Apfelsaft']),
  mc('diesel', 'Sorten', 'Was bekommt man, wenn man ein „Diesel“ bestellt?', ['Bier mit Cola', 'Bier mit Schnaps', 'Ein Starkbier', 'Ein Bier vom Fass im Stehen']),
  mc('krefelder', 'Sorten', 'Was ist ein „Krefelder“?', ['Altbier mit Cola', 'Kölsch mit Sekt', 'Pils mit Malzbier', 'Weizen mit Bananensaft']),
  mc('goassmass', 'Sorten', 'Was ist in einer „Goaßmaß“?', ['Dunkles Bier, Cola und Kirschlikör', 'Weißbier und Ziegenmilch', 'Helles und Apfelschorle', 'Radler mit Rum']),
  mc('kvass', 'Sorten', 'Woraus wird der osteuropäische Kwas traditionell gemacht?', ['Aus Brot', 'Aus Kartoffeln', 'Aus Rüben', 'Aus Milch']),
  mc('chicha', 'Sorten', 'Was ist traditionelle südamerikanische Chicha?', ['Ein Bier aus Mais', 'Ein Weinbrand', 'Ein Kakaogetränk', 'Ein Kaffeelikör'],
    'Früher wurde der Mais dafür sogar gekaut – Speichelenzyme machen Zucker aus der Stärke.'),
  mc('zoigl', 'Sorten', 'Was zeigt der Zoiglstern an einem Haus in der Oberpfalz an?', ['Dass dort gerade Zoiglbier ausgeschenkt wird', 'Ein Sternerestaurant', 'Eine Brauerei-Werkstatt', 'Einen Bierverbots-Tag']),
  mc('kellerbier', 'Sorten', 'Was ist typisch für Kellerbier?', ['Ungefiltert und naturtrüb', 'Besonders stark', 'Immer dunkel', 'Mit Kräutern gewürzt']),

  // ------------------------------------------------------------------ Deutschland
  mc('bl-meiste', 'Deutschland', 'In welchem Bundesland gibt es die meisten Brauereien?', ['Bayern', 'Baden-Württemberg', 'Nordrhein-Westfalen', 'Sachsen']),
  mc('dichte', 'Deutschland', 'Welche Region hat die höchste Brauereidichte der Welt?', ['Oberfranken', 'Allgäu', 'Sauerland', 'Pfalz']),
  num('anzahl-brauereien', 'Deutschland', 'Wie viele Brauereien gibt es ungefähr in Deutschland?', 1450, 200, undefined, 'Laut Statistischem Bundesamt rund 1.400 bis 1.500.'),
  num('wiesn-brauereien', 'Deutschland', 'Wie viele Münchner Brauereien schenken auf dem Oktoberfest aus?', 6, 0, undefined,
    'Augustiner, Hacker-Pschorr, Hofbräu, Löwenbräu, Paulaner und Spaten.'),
  mc('anstich', 'Deutschland', 'Wer zapft auf dem Oktoberfest traditionell das erste Fass an?', ['Der Münchner Oberbürgermeister', 'Der bayerische Ministerpräsident', 'Die Bierkönigin', 'Der älteste Wiesnwirt']),
  mc('nockherberg', 'Deutschland', 'Wo wird beim Starkbieranstich in München „derbleckt“?', ['Auf dem Nockherberg', 'Auf dem Olympiaberg', 'Auf der Theresienwiese', 'Im Hofbräuhaus']),
  mc('augustiner-werbung', 'Deutschland', 'Welche Münchner Brauerei ist dafür bekannt, praktisch keine Werbung zu machen?', ['Augustiner', 'Paulaner', 'Löwenbräu', 'Spaten']),
  mc('slogan-bit', 'Deutschland', '„Bitte ein …“ – welches Bier?', ['Bit', 'Becks', 'Bölkstoff', 'Bier']),
  mc('slogan-warsteiner', 'Deutschland', 'Welches Bier wirbt mit „Das einzig Wahre“?', ['Warsteiner', 'Krombacher', 'Veltins', 'Radeberger']),
  mc('slogan-krombacher', 'Deutschland', 'Welches Bier nennt sich „Eine Perle der Natur“?', ['Krombacher', 'Jever', 'Rothaus', 'Licher']),
  mc('slogan-jever', 'Deutschland', 'Welches Bier ist „friesisch herb“?', ['Jever', 'Flensburger', 'Astra', 'Becks']),
  mc('flens-plop', 'Deutschland', 'Welches Geräusch ist das Markenzeichen der Flensburger Bügelflasche?', ['Plop', 'Zisch', 'Klack', 'Puff']),
  mc('tannenzaepfle', 'Deutschland', 'Aus welcher Region kommt das Tannenzäpfle?', ['Schwarzwald', 'Bayerischer Wald', 'Harz', 'Eifel']),
  mc('becks-stadt', 'Deutschland', 'In welcher Stadt wird Beck’s gebraut?', ['Bremen', 'Hamburg', 'Hannover', 'Kiel']),
  mc('kastanien', 'Deutschland', 'Warum stehen in bayerischen Biergärten so oft Kastanien?', ['Ihr Schatten kühlte die Bierkeller darunter', 'Für die Maronen im Herbst', 'Gegen Mücken', 'Sie waren Pflicht laut Gesetz']),
  mc('brotzeit', 'Deutschland', 'Was darf man in einen traditionellen bayerischen Biergarten mitbringen?', ['Die eigene Brotzeit', 'Das eigene Bier', 'Den eigenen Grill', 'Nichts davon']),
  mc('koebes', 'Deutschland', 'Wie heißt der Kellner in einem Kölner Brauhaus?', ['Köbes', 'Kranz', 'Schorsch', 'Pitter']),
  mc('kranz', 'Deutschland', 'Was ist in Köln ein „Kranz“?', ['Ein Tablett für Kölschstangen', 'Eine Runde Bier', 'Ein Karnevalsorden', 'Ein Kölschglas mit Henkel']),
  mc('masskrugstemmen', 'Deutschland', 'Worum geht es beim Maßkrugstemmen?', ['Einen vollen Maßkrug möglichst lange mit gestrecktem Arm halten', 'Möglichst viele Krüge tragen', 'Einen Krug möglichst weit werfen', 'Einen Krug auf dem Kopf balancieren']),
  mc('schnitt', 'Deutschland', 'Was bekommt man in Bayern, wenn man einen „Schnitt“ bestellt?', ['Ein nur teilweise gefülltes Glas', 'Ein Bier mit Schnaps', 'Eine Scheibe Leberkäs', 'Ein halbes Weißbier']),
  mc('noagerl', 'Deutschland', 'Was ist ein „Noagerl“?', ['Der abgestandene Rest im Glas', 'Ein kleines Bier für Kinder', 'Ein Bierdeckel', 'Ein Brauerlehrling']),

  // ------------------------------------------------------------------ Welt
  mc('guinness-stadt', 'Welt', 'In welcher Stadt wird Guinness gebraut?', ['Dublin', 'Belfast', 'Cork', 'London']),
  num('guinness-pacht', 'Welt', 'Für wie viele Jahre pachtete Arthur Guinness 1759 die Brauerei am St. James’s Gate?', 9000, 500, 'Jahre'),
  mc('pilsner-urquell', 'Welt', 'In welchem Land liegt Pilsen, die Heimat des Pils?', ['Tschechien', 'Österreich', 'Polen', 'Slowakei']),
  mc('prokopf-land', 'Welt', 'In welchem Land wird pro Kopf am meisten Bier getrunken?', ['Tschechien', 'Deutschland', 'Irland', 'Belgien']),
  mc('carlsberg', 'Welt', 'Aus welchem Land stammt Carlsberg?', ['Dänemark', 'Schweden', 'Norwegen', 'Niederlande']),
  mc('heineken', 'Welt', 'Aus welchem Land stammt Heineken?', ['Niederlande', 'Belgien', 'Dänemark', 'Deutschland']),
  mc('abinbev', 'Welt', 'Welcher Konzern ist der größte Bierbrauer der Welt?', ['AB InBev', 'Heineken', 'Carlsberg', 'Asahi']),
  mc('budweiser', 'Welt', 'Um welchen Biernamen streiten sich eine US-Brauerei und eine tschechische Brauerei seit über 100 Jahren?', ['Budweiser', 'Pilsner', 'Lager', 'Corona']),
  mc('sake', 'Welt', 'Sake wird hergestellt wie …', ['Bier – aus Reis, mit Verzuckerung und Gärung', 'Wein – aus Trauben', 'Schnaps – nur destilliert', 'Tee – aufgebrüht']),
  mc('ninkasi', 'Welt', 'Wie hieß die sumerische Göttin des Bieres?', ['Ninkasi', 'Isis', 'Freya', 'Hathor']),

  // ------------------------------------------------------------------ Zahlen
  num('mass', 'Zahlen', 'Wie viel Liter passen in eine Maß?', 1, 0.1, 'l'),
  num('stange', 'Zahlen', 'Wie viel Liter fasst eine klassische Kölschstange?', 0.2, 0.05, 'l'),
  num('kasten', 'Zahlen', 'Wie viele 0,5-l-Flaschen sind in einem normalen Bierkasten?', 20, 0, 'Flaschen'),
  num('zacken', 'Zahlen', 'Wie viele Zacken hat ein normaler Kronkorken?', 21, 1, 'Zacken'),
  num('hektoliter', 'Zahlen', 'Wie viele Maß sind ein Hektoliter?', 100, 0, 'Maß'),
  num('prokopf', 'Zahlen', 'Wie viel Liter Bier trinkt man in Deutschland pro Kopf und Jahr ungefähr?', 88, 12, 'l'),
  num('wiesn-mass', 'Zahlen', 'Wie viele Millionen Maß werden auf einem Oktoberfest ungefähr getrunken?', 7, 1.5, 'Mio.'),
  num('alkoholfrei-grenze', 'Zahlen', 'Bis zu wie viel Prozent Alkohol darf „alkoholfreies“ Bier in Deutschland enthalten?', 0.5, 0.1, '% vol'),
  num('kalorien-alkohol', 'Zahlen', 'Wie viele Kilokalorien hat ein Gramm Alkohol ungefähr?', 7, 1, 'kcal'),
  num('kalorien-pils', 'Zahlen', 'Wie viele Kilokalorien hat ein halber Liter Pils ungefähr?', 210, 40, 'kcal'),
  num('gefrierpunkt', 'Zahlen', 'Bei wie viel Grad gefriert ein normales 5-%-Bier ungefähr?', -2, 1, '°C'),
  num('pils-temperatur', 'Zahlen', 'Bei wie viel Grad schmeckt ein Pils am besten (Faustregel)?', 8, 2, '°C'),
  num('sieben-minuten', 'Zahlen', 'Wie viele Minuten dauert ein gutes Pils angeblich?', 7, 0, 'min', 'Ein schöner Mythos – gut gezapft geht’s auch in drei.'),

  // ------------------------------------------------------------------ Kurioses
  mc('cenosillicaphobie', 'Kurioses', 'Was bezeichnet man scherzhaft als „Cenosillicaphobie“?', ['Die Angst vor einem leeren Glas', 'Die Angst vor Schaum', 'Die Angst vor Kronkorken', 'Die Angst vor Hopfen']),
  mc('zythologie', 'Kurioses', 'Wie nennt man die Bierkunde?', ['Zythologie', 'Önologie', 'Hopfologie', 'Cerevisiologie']),
  mc('fluessiges-brot', 'Kurioses', 'Wie nannten Mönche ihr nahrhaftes Fastenbier?', ['Flüssiges Brot', 'Heiliges Wasser', 'Klostersuppe', 'Fastentrunk']),
  mc('hopfen-malz', 'Kurioses', '„Hopfen und Malz – …“', ['… Gott erhalt’s', '… ist alles, was zählt', '… macht den Bauch rund', '… bringt das Salz']),
  mc('prost', 'Kurioses', 'Was bedeutet „Prost“ ursprünglich?', ['„Es möge nützen“ (lat. prosit)', '„Trink aus“', '„Auf dich“', '„Gesundheit“ auf Griechisch']),
  mc('stiefel', 'Kurioses', 'Was muss man beim Trinken aus einem Bierstiefel beachten?', ['Die Spitze zur Seite drehen, sonst gibt’s einen Schwall', 'Mit dem Absatz anstoßen', 'Nur mit links trinken', 'Ihn vorher schütteln']),
  mc('braune-flasche-gruen', 'Kurioses', 'Was droht Bier in grünen oder klaren Flaschen im Sonnenlicht?', ['Ein „Lichtgeschmack“, der an Stinktier erinnert', 'Es wird stärker', 'Es wird süßer', 'Gar nichts']),
  mc('arnold', 'Kurioses', 'Wer gilt als ein Schutzpatron der Brauer?', ['Der heilige Arnold', 'Der heilige Florian', 'Der heilige Christophorus', 'Der heilige Nikolaus']),
  mc('bierbauch', 'Kurioses', 'Was macht den sogenannten Bierbauch vor allem aus?', ['Zu viele Kalorien insgesamt', 'Der Hopfen', 'Die Kohlensäure', 'Das Malz allein']),
  mc('schaum', 'Kurioses', 'Was hält die Schaumkrone stabil?', ['Eiweiße aus dem Malz und Bitterstoffe aus dem Hopfen', 'Zugesetztes Spülmittel', 'Nur die Kohlensäure', 'Der Zucker']),
  mc('pinkeln', 'Kurioses', 'Warum muss man nach Bier oft zur Toilette?', ['Alkohol hemmt ein Hormon, das Wasser im Körper hält', 'Hopfen ist harntreibend wie Kaffee', 'Kohlensäure drückt auf die Blase', 'Wegen des Salzes']),

  mc('rhg-preis', 'Geschichte', 'Was regelte das Reinheitsgebot von 1516 außer den Zutaten noch?', ['Den Bierpreis', 'Die Sperrstunde', 'Die Glasgröße', 'Das Mindestalter']),
  num('rhg-jubilaeum', 'Geschichte', '2016 feierte das Reinheitsgebot ein rundes Jubiläum – welches?', 500, 0, 'Jahre'),
  mc('helles', 'Geschichte', 'Welche Münchner Brauerei braute 1894 das erste Münchner Helle?', ['Spaten', 'Augustiner', 'Paulaner', 'Hofbräu']),
  mc('weissbier-monopol', 'Geschichte', 'Wer durfte in Bayern lange als Einziger Weißbier brauen?', ['Das Herrscherhaus der Wittelsbacher', 'Die Klöster', 'Die Stadt München', 'Jeder Wirt mit Garten']),
  mc('schneider', 'Geschichte', 'Wer kaufte 1872 das Weißbier-Braurecht vom König und rettete damit das Weißbier?', ['Georg Schneider', 'Gabriel Sedlmayr', 'Joseph Pschorr', 'Ludwig Erdinger']),
  mc('bierdeckel', 'Geschichte', 'Wozu dienten Bierdeckel ursprünglich?', ['Als Deckel auf dem Krug – gegen Fliegen und Schmutz', 'Als Zahlungsmittel', 'Als Spielkarten', 'Zum Notieren der Bestellung']),
  mc('craft', 'Welt', 'Aus welchem Land kam die moderne Craft-Beer-Bewegung?', ['USA', 'Belgien', 'England', 'Deutschland']),
  mc('cascade', 'Welt', 'Welche Hopfensorte prägte die ersten amerikanischen Pale Ales?', ['Cascade', 'Hallertauer Mittelfrüh', 'Saazer', 'Tettnanger']),
  mc('saison', 'Welt', 'Für wen wurde belgisches Saison ursprünglich gebraut?', ['Für Landarbeiter in der Erntezeit', 'Für Mönche', 'Für den König', 'Für Seeleute']),
  mc('ozapft', 'Deutschland', 'Was ruft der Oberbürgermeister nach dem Anstich auf der Wiesn?', ['„O’zapft is!“', '„Prost Wiesn!“', '„Auf geht’s!“', '„Hoch die Krüge!“']),
  mc('zoigl-region', 'Deutschland', 'In welcher Region ist das Zoiglbier zu Hause?', ['Oberpfalz', 'Allgäu', 'Rheinland', 'Ostfriesland']),
  mc('bamberg', 'Deutschland', 'Welche Welterbe-Stadt ist für ihr Rauchbier berühmt?', ['Bamberg', 'Regensburg', 'Lübeck', 'Quedlinburg']),
  mc('dortmund', 'Deutschland', 'Welche Stadt galt in den 1960ern als größte Bierstadt Europas?', ['Dortmund', 'München', 'Köln', 'Hamburg']),
  mc('hopfenernte', 'Brauen', 'Wann wird in der Hallertau Hopfen geerntet?', ['Ende August bis Mitte September', 'Im Mai', 'Im Dezember', 'Das ganze Jahr']),
  num('hopfen-hoehe', 'Brauen', 'Wie hoch ranken Hopfenpflanzen an ihren Gerüsten ungefähr?', 7, 1.5, 'm'),
  mc('weizenglas', 'Kurioses', 'Warum spült man ein Weizenglas vor dem Einschenken kalt aus?', ['Damit der Schaum nicht überschäumt', 'Damit es nach Wasser schmeckt', 'Aus Aberglauben', 'Damit es nicht zerspringt']),
  mc('augen', 'Kurioses', 'Was sollte man beim Anstoßen laut Volksglauben unbedingt tun?', ['Sich in die Augen schauen', 'Die Gläser unten anstoßen', 'Laut „Prost“ rufen', 'Den Ellbogen anwinkeln'],
    'Sonst drohen angeblich sieben Jahre Pech in der Liebe.'),

  // ------------------------------------------------------------------ Sprache
  mc('halbe', 'Sprache', 'Was ist eine „Halbe“?', ['Ein halber Liter Bier', 'Ein halbes Glas Schaum', 'Ein Bier halb Hell, halb Dunkel', 'Ein Kinderbier']),
  mc('bierleiche', 'Sprache', 'Was ist eine „Bierleiche“?', ['Jemand, der zu viel getrunken hat und schläft', 'Ein leeres Fass', 'Ein abgestandenes Bier', 'Ein gebrochener Krug']),
  mc('bierernst', 'Sprache', 'Was bedeutet „bierernst“?', ['Übertrieben ernst', 'Betrunken, aber ernst', 'Sehr witzig', 'Absolut zuverlässig']),
  mc('nicht-mein-bier', 'Sprache', '„Das ist nicht mein Bier“ heißt …', ['Das ist nicht meine Angelegenheit', 'Das schmeckt mir nicht', 'Das habe ich nicht bestellt', 'Das bezahle ich nicht']),
  mc('kumpel', 'Sprache', 'Was ist im Ruhrgebiet ein „Pülleken“?', ['Eine kleine Bierflasche', 'Ein Bierkasten', 'Ein Bergmann', 'Ein Kronkorken']),
  mc('pfiff', 'Sprache', 'Was ist in Österreich ein „Pfiff“?', ['Ein sehr kleines Bier', 'Ein Pfiff des Kellners für die Rechnung', 'Ein Radler', 'Ein Starkbier']),
  mc('seidla', 'Sprache', 'Was bestellt man in Franken mit einem „Seidla“?', ['Ein Bier im Krug', 'Eine Brotzeit', 'Einen Schnaps', 'Ein Radler']),
  mc('feierabendbier', 'Sprache', 'Welches Wort gibt es (fast) nur im Deutschen?', ['Feierabendbier', 'Lager', 'Pint', 'Stout']),
]

// ------------------------------------------------------------------------------------------ Auswahl & Prüfung

export const qById = (id: string) => QUESTIONS.find((q) => q.id === id)

export interface Answer {
  question: string
  correct: boolean
  exact: boolean
  answered_at: string
}

/** Antwortmöglichkeiten gemischt – liefert Reihenfolge + Index der richtigen */
export function shuffled(q: McQuestion): { options: string[]; correct: number } {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5)
  return { options: order.map((i) => q.options[i]), correct: order.indexOf(q.answer) }
}

export function checkNum(q: NumQuestion, guess: number): { correct: boolean; exact: boolean } {
  return { correct: Math.abs(guess - q.answer) <= q.tol + 1e-9, exact: Math.abs(guess - q.answer) < 1e-9 }
}

/** Neue Fragen zuerst, dann früher falsch beantwortete, dann am längsten nicht gestellte */
export function pickQuestions(
  n: number,
  history: Answer[],
  filter: (q: Question) => boolean = () => true,
): Question[] {
  const last = new Map<string, { t: number; ok: boolean }>()
  for (const a of history) {
    const t = new Date(a.answered_at).getTime()
    const prev = last.get(a.question)
    if (!prev || t > prev.t) last.set(a.question, { t, ok: a.correct })
  }
  const pool = QUESTIONS.filter(filter).map((q) => {
    const h = last.get(q.id)
    const score = !h ? 0 : !h.ok ? 1 : 2 + (Date.now() - h.t > 30 * 86400000 ? 0 : 1)
    return { q, score: score + Math.random() * 0.9 }
  })
  pool.sort((a, b) => a.score - b.score)
  // nicht zwei Fragen derselben Kategorie hintereinander, wenn es sich vermeiden lässt
  const out: Question[] = []
  const rest = pool.map((x) => x.q)
  while (out.length < n && rest.length) {
    const i = rest.findIndex((q) => q.cat !== out[out.length - 1]?.cat)
    out.push(rest.splice(i >= 0 ? i : 0, 1)[0])
  }
  return out
}

// ------------------------------------------------------------------------------------------ Datenbank

let cache: Answer[] | null = null

export async function myAnswers(): Promise<Answer[]> {
  if (cache) return cache
  const res = await supabase.from('quiz_answers').select('question, correct, exact, answered_at').order('answered_at')
  if (res.error) throw new Error(res.error.message)
  cache = res.data as Answer[]
  return cache
}

export async function saveAnswer(question: string, correct: boolean, exact: boolean) {
  const row = { question, correct, exact, answered_at: new Date().toISOString() }
  cache?.push(row)
  const res = await supabase.from('quiz_answers').insert({ question, correct, exact })
  if (res.error) throw new Error(res.error.message)
}

export function resetQuiz() {
  cache = null
}

export interface QuizStats {
  answered: number
  correct: number
  exact: number
  bestStreak: number
  cats: Map<QuizCat, number>
}

export function quizStats(list: Answer[]): QuizStats {
  let streak = 0
  let best = 0
  const cats = new Map<QuizCat, number>()
  for (const a of list) {
    if (a.correct) {
      streak++
      best = Math.max(best, streak)
      const c = qById(a.question)?.cat
      if (c) cats.set(c, (cats.get(c) ?? 0) + 1)
    } else streak = 0
  }
  return {
    answered: list.length,
    correct: list.filter((a) => a.correct).length,
    exact: list.filter((a) => a.exact).length,
    bestStreak: best,
    cats,
  }
}
