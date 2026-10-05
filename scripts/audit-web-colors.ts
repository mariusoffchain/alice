import { writeFileSync } from 'node:fs';
import { PALETTES, ALL_PALETTE_IDS } from '../packages/alice-content/src/theme.ts';
import { webThemeTokens } from '../apps/app-web/src/lib/theme-tokens.ts';
import { contrastRatio } from '../apps/app-web/src/lib/color-contrast.ts';

const rows: string[] = [];
for (const mode of ['light','dark'] as const) for (const palette of ALL_PALETTE_IDS) {
 const t=webThemeTokens(mode,palette);
 const surfaces=['--alice-bg','--alice-bg-soft','--alice-card-bg','--alice-hover'] as const;
 const min=(fg:keyof typeof t)=>Math.min(...surfaces.map(bg=>contrastRatio(t[fg],t[bg])));
 const reading=Math.min(min('--alice-text'),min('--alice-muted'));
 const accent=min('--alice-primary'), controls=min('--alice-control-border');
 const states=Math.min(...(['--alice-danger','--alice-success','--alice-warning','--alice-info'] as const).map(min));
 if (reading<4.5 || accent<4.5 || controls<3 || states<4.5) throw new Error(`Failed ${mode}/${palette}`);
 rows.push(`| ${PALETTES[palette].label} | ${mode==='light'?'Clair':'Sombre'} | ${reading.toFixed(2)} | ${accent.toFixed(2)} | ${controls.toFixed(2)} | ${states.toFixed(2)} |`);
}
const report=`# Audit des couleurs Atelier

Audit du 2026-10-04. Calculs sRGB, transparences des surfaces compositées avant mesure. Les seuils sont contrôlés avant arrondissement.

## Référence

- [WCAG 2.2, contraste du texte](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — minimum 4,5:1 pour le texte courant, y compris les indications dans les champs.
- [WCAG 2.2, contraste non textuel](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) — minimum 3:1 pour les repères nécessaires aux commandes et états.
- [Usage de la couleur](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) — les états doivent aussi être identifiables autrement que par la couleur.

## Écarts constatés avant correction

Au commit précédent, l’indication de raisonnement utilisait l’encre secondaire avec une opacité supplémentaire de 0,7. Le calcul sur le fond de saisie donnait 2,66:1 en bleu clair et 3,54:1 en bleu sombre, sous le seuil de 4,5:1. Les icônes d’action à 0,35 d’opacité atteignaient seulement 1,58:1 sur le fond bleu clair et 2,15:1 sur le fond bleu sombre. Les contrôles de palette précédents ne couvraient pas ces opacités rendues ni toutes les surfaces de survol.

## Matrice après correction

Chaque cellule donne le plus faible ratio parmi les surfaces principales, secondaires, cartes et survols. « Texte » inclut les textes secondaires. Les couleurs d’état restent distinctes de la couleur de marque.

| Palette | Mode | Texte ≥4,5 | Accent/liens ≥4,5 | Contours fonctionnels ≥3 | Textes d’état ≥4,5 |
|---|---|---:|---:|---:|---:|
${rows.join('\n')}

Les tests vérifient aussi les textes sur boutons d’accent et de danger, les messages d’avertissement sur leurs fonds, les encres des panneaux colorés et les 2 variantes de sélection. Les séparateurs décoratifs et contrôles désactivés n’emploient pas les mêmes seuils que les commandes actives.

## Cohérence des teintes, correction complémentaire

Le fond secondaire clair hérité était identique dans toutes les palettes et contenait une dominante bleue. Il est désormais calculé à partir de la couleur choisie, comme les cartes, survols et supports d’illustrations. Les 8 fonds secondaires clairs sont distincts. Le test rouge clair vérifie que les surfaces n’ont pas de dominante bleue ; les surfaces monochromes doivent avoir des canaux RVB égaux. Ces tests complètent les contrastes et empêchent la régression illustrée par la capture utilisateur.

Les couleurs fixes des courbes de solde, des rubans de transactions et des badges génériques d’Explorer utilisent désormais les tokens. Les avertissements de compte, les quiz et les états de Playground utilisent les couleurs sémantiques. Les codes couleur des réseaux et des échelles de frais restent des données métier, les QR restent lisibles sur fond blanc, et les couleurs incorporées aux illustrations externes ne sont pas recolorisées automatiquement.

## Cohérence et portée

- 1 encre secondaire commune aux commandes, métadonnées et icônes de menu, sans accumulation d’opacités.
- La couleur de marque suit la palette pour le lapin, les liens et le focus. Le bleu codé en dur du bouton Save a été supprimé.
- Le monochrome conserve des encres et accents neutres ; erreurs et avertissements gardent leurs couleurs sémantiques et leurs libellés.
- Un contour fonctionnel distinct permet de laisser les séparateurs discrets tout en identifiant le champ de saisie et les contrôles.
- Vérification navigateur des 16 choix via Apparence, des couleurs calculées du lapin et du champ, de l’opacité des indications et du sélecteur de modèle. Des états sélectionnés restent signalés par la graisse, la position, une marque ou un libellé, en plus de la couleur.

Portée de la correction visuelle détaillée — chat, barre latérale, menus et réglages partagés. Les pages Explorer, Learn, Playground, leurs illustrations et leurs graphiques métier n’ont pas fait l’objet d’un inventaire visuel exhaustif. Elles héritent des tokens communs mais doivent être vérifiées lors de leur déclinaison. Ceci n’est pas une déclaration de conformité WCAG de l’application entière, ni un audit clavier/lecteur d’écran complet.

## Reconstruction

Depuis la racine du dépôt, avec Node 24, lancer \`node scripts/audit-web-colors.ts\` pour régénérer cette matrice, puis \`node --test apps/app-web/src/lib/theme-tokens.test.ts apps/app-web/src/lib/rabbit-player.test.ts apps/app-web/src/lib/color-contrast.test.ts\`. La prévisualisation locale utilise la compilation de production app-web servie sur le port 3017.
`;
writeFileSync('docs/design/atelier-color-audit.md',report);
console.log(rows.join('\n'));
