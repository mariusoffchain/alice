// French translations of the Explorer corpus. Only the retrievable surface
// (title, summary, body, extra retrieval terms) is translated here; the guards
// (legalPosture, preconditions, dates, sources) stay on the source Fiche in
// fiche-corpus.ts and are never duplicated. Each entry is a reviewed translation,
// kept faithful to the English meaning, with dated facts preserved verbatim.
//
// These feed alice-ai's per-concept locale selection (preferKnowledgeLocale): a
// French reader retrieves the French variant, an English reader the source, both
// mapping back to the same Fiche id for citation and gating.

import type { FicheId } from './fiche.ts';
import type { FicheTranslation } from './fiche.ts';

// A translation carries the same locale for every entry here.
type FrText = Omit<FicheTranslation, 'locale'>;

export const FICHE_FR: Record<FicheId, FrText> = {
  FICHE_ADDRESS_REUSE: {
    title: "Réutilisation d'adresse",
    summary: "Réutiliser une adresse relie publiquement tous ses paiements. Utilise une adresse neuve pour chaque paiement.",
    body:
      "Une adresse Bitcoin est faite pour servir une seule fois. Quand la même adresse " +
      "reçoit plus d'un paiement, quiconque lit la chaîne voit que ces paiements ont un " +
      "propriétaire commun, et toute étiquette rattachée à l'adresse (une signature de forum, " +
      "une page de dons publique, un reçu) se rattache d'un coup à tous. Le lien est " +
      "permanent et ne peut pas être retiré après coup, donc le correctif regarde vers " +
      "l'avant: donne une nouvelle adresse à chaque payeur, ce que la plupart des " +
      "portefeuilles génèrent automatiquement. Cela n'annule pas la réutilisation passée, " +
      "cela empêche l'historique de grossir.",
    retrievalHints: ["réutilisation d'adresse", "adresse réutilisée", "adresse neuve", "nouvelle adresse par paiement", "éviter la réutilisation"],
  },
  FICHE_COIN_CONTROL: {
    title: "Contrôle des pièces",
    summary: "Choisir à la main quelles pièces une transaction dépense, pour ne pas relier des historiques que tu voulais garder séparés.",
    body:
      "Le contrôle des pièces (coin control) consiste à choisir à la main quelles sorties " +
      "non dépensées (UTXO) une transaction dépense, au lieu de laisser le portefeuille " +
      "choisir tout seul. C'est important pour la vie privée parce que combiner plusieurs " +
      "entrées dans une même transaction les relie publiquement à un seul propriétaire " +
      "(l'heuristique de propriété commune des entrées). Garder délibérément à part des " +
      "pièces aux historiques différents, du KYC contre du non-KYC, un don public contre " +
      "une épargne privée, évite de créer des liens non voulus. Les étiquettes d'UTXO le " +
      "rendent praticable, et la plupart des portefeuilles de bureau exposent la fonction; " +
      "l'utiliser est une habitude, pas un geste ponctuel.",
    retrievalHints: ["contrôle des pièces", "sélection des UTXO", "gestion des UTXO", "choisir les entrées"],
  },
  FICHE_SILENT_PAYMENTS: {
    title: "Paiements silencieux (Silent Payments)",
    summary: "Publier une seule adresse statique alors que chaque paiement arrive quand même sur une sortie différente et non reliable.",
    body:
      "Les paiements silencieux (BIP 352) permettent à un destinataire de publier une " +
      "seule adresse statique alors que chaque paiement arrive quand même sur une sortie " +
      "on-chain différente et non reliable. L'expéditeur dérive une destination unique à " +
      "partir de la clé publique du destinataire et des entrées de la transaction elle-même, " +
      "sans transaction de notification séparée. Cela résout la tension centrale d'une " +
      "adresse publique réutilisable: tu peux partager une adresse pour des dons ou un " +
      "profil sans relier entre eux tous les paiements entrants. La contrepartie est que le " +
      "destinataire doit scanner la chaîne pour retrouver ses paiements, et le support des " +
      "portefeuilles est encore en cours de déploiement.",
    retrievalHints: ["paiements silencieux", "BIP352", "adresse statique", "adresse réutilisable"],
  },
  FICHE_PAYJOIN: {
    title: "PayJoin",
    summary: "Un paiement d'apparence ordinaire où le destinataire ajoute aussi une entrée, ce qui trompe l'analyse fondée sur les entrées.",
    body:
      "PayJoin (BIP 78, aussi appelé P2EP) est un paiement d'apparence ordinaire où le " +
      "destinataire apporte aussi une de ses propres entrées. Cela casse l'hypothèse " +
      "courante selon laquelle toutes les entrées d'une transaction appartiennent à un seul " +
      "payeur, donc une analyse qui lit les entrées comme un seul propriétaire est trompée. " +
      "Comme le résultat ressemble à un paiement ordinaire, cela aide aussi les autres " +
      "utilisateurs en rendant l'heuristique moins fiable en général. L'adoption dépend à la " +
      "fois du portefeuille et du destinataire (commerçant ou serveur) qui doivent le " +
      "prendre en charge.",
    retrievalHints: ["payjoin", "BIP78", "P2EP", "transaction collaborative"],
  },
  FICHE_COINJOIN: {
    title: "CoinJoin",
    summary: "Une transaction collaborative où plusieurs utilisateurs partagent entrées et sorties de valeur égale, affaiblissant le lien entre qui a payé qui.",
    body:
      "Un CoinJoin est une seule transaction que plusieurs utilisateurs construisent " +
      "ensemble, en combinant leurs entrées et en produisant des sorties de valeur égale, " +
      "de sorte qu'un observateur ne peut plus dire quelle entrée a financé quelle sortie. " +
      "Il ne cache pas la transaction; il casse l'heuristique de propriété commune des " +
      "entrées en rendant de nombreux appariements plausibles. La variante chaumienne " +
      "utilise des signatures aveugles pour que le coordinateur du tour ne puisse pas " +
      "lui-même relier les entrées enregistrées aux sorties finales. La confidentialité " +
      "gagnée ne vaut que ce que vaut l'ambiguïté des sorties égales (l'ensemble d'anonymat) " +
      "et, surtout, ce que l'utilisateur fait ensuite: dépenser la monnaie rendue ou les " +
      "pièces mélangées sans précaution peut tout défaire (voir monnaie rendue toxique). Le " +
      "CoinJoin est un flux de travail, pas un correctif en un clic.",
    retrievalHints: ["coinjoin", "transaction collaborative", "sorties égales", "signatures aveugles", "mélange collaboratif"],
  },
  FICHE_COINJOIN_LANDSCAPE: {
    title: "Implémentations de CoinJoin et leur statut",
    summary: "Les principales implémentations de CoinJoin et comment la répression de 2024 a redessiné le paysage.",
    body:
      "Les implémentations de CoinJoin diffèrent surtout par leur façon de coordonner. " +
      "JoinMarket est un marché non-custodial où des makers offrent de la liquidité à des " +
      "takers contre des frais, sans coordinateur central. Wasabi utilisait un coordinateur " +
      "avec le protocole WabiSabi. Whirlpool, de Samourai Wallet, utilisait des pools à " +
      "montants fixes avec une transaction préparatoire (TX0), des mélanges et des remélanges " +
      "gratuits. Samourai proposait aussi des techniques liées: Stonewall (une transaction à " +
      "un seul utilisateur façonnée pour ressembler à une petite collaboration, Stonewall x2 " +
      "ajoutant un vrai second participant) et Ricochet (des sauts intermédiaires " +
      "supplémentaires pour éloigner les fonds d'une source signalée). En 2024 le sol a " +
      "bougé: les fondateurs de Samourai ont été inculpés par le DOJ américain en avril 2024 " +
      "pour blanchiment d'argent et exploitation d'un transmetteur de fonds sans licence, et " +
      "le coordinateur de Wasabi a été fermé. Ashigaru, un fork communautaire, poursuit " +
      "l'outillage Whirlpool et Dojo, et des conceptions plus récentes comme JoinStr " +
      "coordonnent via Nostr pour supprimer entièrement le coordinateur central. La " +
      "disponibilité et l'exposition légale varient selon l'outil et la juridiction et " +
      "changent vite.",
    retrievalHints: ["whirlpool", "wasabi", "wabisabi", "joinmarket", "ashigaru", "joinstr", "samourai", "stonewall", "ricochet"],
  },
  FICHE_BIP47_PAYNYM: {
    title: "Codes de paiement réutilisables (BIP 47 / PayNym)",
    summary: "Publier un code de paiement; chaque expéditeur dérive pour toi des adresses neuves, évitant la réutilisation d'adresse pour les paiements récurrents.",
    body:
      "Les codes de paiement réutilisables BIP 47 permettent de publier un seul code (un " +
      "PayNym en est une implémentation) au lieu d'une adresse statique. Chaque payeur " +
      "combine ton code avec une dérivation partagée (ECDH) pour calculer une adresse neuve " +
      "et unique à chaque paiement, de sorte que les paiements récurrents ne s'entassent plus " +
      "sur une adresse réutilisée. Le coût est une transaction de notification on-chain pour " +
      "établir la relation la première fois, ce qui laisse une petite empreinte, et les deux " +
      "portefeuilles doivent le prendre en charge. Cela résout le même problème que les " +
      "paiements silencieux, un identifiant statique partageable sans réutilisation, avec une " +
      "contrepartie différente.",
    retrievalHints: ["BIP47", "code de paiement", "code de paiement réutilisable", "paynym", "transaction de notification"],
  },
  FICHE_TOXIC_CHANGE: {
    title: "Monnaie rendue toxique",
    summary: "Une sortie de monnaie rendue qui garde un lien vers une source sensible; la dépenser avec des pièces privées te ré-expose.",
    body:
      "La monnaie rendue toxique est une sortie de monnaie rendue qui porte encore un lien " +
      "vers une origine sensible, par exemple la monnaie laissée par une préparation de " +
      "CoinJoin (TX0) ou par la dépense de pièces signalées. Elle peut être isolée par des " +
      "heuristiques de montant, de script ou de comportement. Le danger vient après la " +
      "transaction: si tu dépenses plus tard cette monnaie rendue avec des fonds privés, " +
      "l'heuristique de propriété commune des entrées reconnecte les deux historiques que tu " +
      "avais tenté de séparer. L'isoler avec des étiquettes et le contrôle des pièces, et ne " +
      "pas la fusionner avec des pièces propres, voilà ce qui préserve le travail de " +
      "confidentialité déjà fait.",
    retrievalHints: ["monnaie rendue toxique", "sortie de monnaie rendue", "postmix", "monnaie TX0"],
  },
  FICHE_CONSOLIDATION: {
    title: "La consolidation et son coût pour la vie privée",
    summary: "Fusionner de nombreux UTXO en un seul coûte peu en frais mais relie publiquement des pièces qui étaient séparées.",
    body:
      "La consolidation fusionne plusieurs UTXO en une ou quelques sorties, souvent pour " +
      "économiser des frais futurs quand le mempool est bon marché. C'est une optimisation " +
      "de frais raisonnable, mais elle a un coût pour la vie privée: mettre plusieurs pièces " +
      "dans une même transaction déclenche l'heuristique de propriété commune des entrées et " +
      "relie publiquement des historiques qui étaient jusque-là séparés. Garde l'optimisation " +
      "des frais et la confidentialité comme deux décisions distinctes: consolide des pièces " +
      "qui appartiennent déjà au même cluster visible, et ne fusionne jamais du KYC avec du " +
      "non-KYC ou des compartiments sans rapport juste pour économiser des frais.",
    retrievalHints: ["consolidation", "fusionner des UTXO", "consolidation d'UTXO"],
  },
  FICHE_CIOH: {
    title: "Heuristique de propriété commune des entrées",
    summary: "L'hypothèse que toutes les entrées d'une transaction ont un seul propriétaire. Puissante, mais pas toujours vraie.",
    body:
      "L'heuristique de propriété commune des entrées (CIOH) suppose que si une transaction " +
      "a plusieurs entrées, une seule entité les contrôle toutes, parce que chaque entrée " +
      "doit être signée pour être dépensée. Elle tient bien pour les transactions ordinaires " +
      "et non collaboratives et c'est une pierre angulaire de la surveillance on-chain. Elle " +
      "est mise en défaut par les transactions collaboratives: CoinJoin et PayJoin placent " +
      "délibérément dans la même transaction des entrées de propriétaires différents, si bien " +
      "que lire les entrées comme un seul propriétaire devient faux. La consolidation, à " +
      "l'inverse, la renforce. Connaître ses limites est ce qui garde l'analyse de chaîne " +
      "honnête: elle produit des hypothèses, pas des preuves.",
    retrievalHints: ["propriété commune des entrées", "CIOH", "clustering des entrées", "heuristique multi-entrées"],
  },
  FICHE_TRANSACTION_HEURISTICS: {
    title: "Heuristiques de transaction",
    summary: "Règles d'inférence pour lire une transaction: quelle sortie est la monnaie rendue, quelles entrées sont liées, quel portefeuille l'a faite.",
    body:
      "Les heuristiques de transaction sont des règles d'inférence que les analystes " +
      "utilisent pour interpréter une transaction sans preuve d'identité. Les heuristiques " +
      "internes lisent la transaction elle-même: montants, nombres ronds, types de sorties, " +
      "ordre des entrées (par exemple BIP 69), types de scripts et motifs de monnaie rendue. " +
      "Les heuristiques externes ajoutent du contexte hors chaîne: dossiers KYC, horodatage, " +
      "adresses réutilisées, révélations publiques, fuites. Aucune heuristique seule ne " +
      "prouve la propriété, mais plusieurs combinées peuvent réduire fortement l'incertitude. " +
      "Les transactions collaboratives et les portefeuilles qui évitent les motifs " +
      "révélateurs les affaiblissent. Raisonner sur la surveillance, c'est séparer ce qui est " +
      "prouvé on-chain de ce qui n'est qu'inféré par un modèle.",
    retrievalHints: ["heuristiques de transaction", "détection de monnaie rendue", "nombre rond", "bip69", "empreinte de portefeuille"],
  },
  FICHE_ANONYMITY_SET: {
    title: "Ensemble d'anonymat",
    summary: "L'ensemble des interprétations plausibles autour d'une pièce. Plus il est grand, plus il est dur de relier une entrée à une sortie.",
    body:
      "Un ensemble d'anonymat mesure combien d'interprétations plausibles entourent une pièce " +
      "ou une transaction. Dans un CoinJoin à sorties de valeur égale, chaque sortie pourrait " +
      "plausiblement correspondre à plusieurs entrées, et plus cet ensemble est grand, plus " +
      "il est dur de relier une entrée précise à une sortie précise. C'est une idée " +
      "probabiliste, pas une garantie: un grand ensemble sur le papier ne vaut rien si " +
      "l'utilisateur fusionne ensuite des pièces ou réutilise une adresse et effondre " +
      "l'ambiguïté. Des mesures comme l'entropie de transaction tentent de le quantifier. " +
      "Présenter la confidentialité comme la taille d'un ensemble d'anonymat, plutôt que " +
      "comme anonyme ou pas, est l'image la plus honnête.",
    retrievalHints: ["ensemble d'anonymat", "anonset", "sorties égales"],
  },
  FICHE_ENTROPY_ANALYSIS: {
    title: "Entropie de transaction (Boltzmann)",
    summary: "Une mesure du nombre d'interprétations entrées-sorties valides d'une transaction. Plus d'entropie, plus d'ambiguïté.",
    body:
      "L'entropie de transaction compte et pondère les façons valides d'apparier les entrées " +
      "d'une transaction avec ses sorties: beaucoup d'interprétations plausibles signifient " +
      "une entropie élevée et une bonne ambiguïté (typique d'un CoinJoin), tandis qu'une " +
      "seule interprétation signifie que la transaction se lit clairement. L'algorithme " +
      "Boltzmann de LaurentMT formalise cela et dérive aussi une probabilité de lien entre " +
      "chaque entrée et chaque sortie; un portage TypeScript maintenu vit dans l'outillage " +
      "Dojo. L'efficacité compare l'entropie atteinte au maximum possible pour cette forme. " +
      "L'entropie est un vocabulaire de l'ambiguïté, pas une promesse d'anonymat: des liens " +
      "déterministes peuvent encore tout figer malgré une structure d'apparence complexe, et " +
      "le calcul explose de façon combinatoire au-delà d'une douzaine d'entrées et de sorties.",
    retrievalHints: ["entropie", "boltzmann", "entropie de transaction", "probabilité de lien", "liens déterministes"],
  },
  FICHE_CHAIN_ANALYSIS: {
    title: "Analyse de chaîne",
    summary: "Utiliser les données publiques de la blockchain plus du contexte hors chaîne pour regrouper des adresses, inférer des propriétaires et suivre des fonds.",
    body:
      "L'analyse de chaîne exploite la blockchain publique pour regrouper des transactions, " +
      "inférer des propriétaires, suivre des flux et attacher des probabilités d'identité. " +
      "Elle combine des heuristiques on-chain (clustering des entrées, détection de monnaie " +
      "rendue, montants, horodatage, types de scripts) avec des données hors chaîne (dossiers " +
      "KYC, adresses publiques, fuites). Les résultats sont des hypothèses probabilistes, " +
      "plus ou moins robustes, pas des preuves. C'est pourquoi Bitcoin est pseudonyme, pas " +
      "anonyme, par défaut. Les défenses reflètent les heuristiques: réduire les liens que tu " +
      "crées, éviter les motifs évidents, et minimiser les données hors chaîne qui rattachent " +
      "une adresse à toi.",
    retrievalHints: ["analyse de chaîne", "surveillance de la blockchain", "clustering", "clustering d'adresses", "traçage des fonds"],
  },
  FICHE_CUSTODIAL_MIXER: {
    title: "Mélangeurs custodial (tumblers)",
    summary: "Un service à qui tu confies la garde de pièces, qui en rend d'autres pour brouiller la piste. La catégorie à l'exposition légale la plus lourde.",
    body:
      "Un mélangeur custodial, ou tumbler, est un service auquel tu envoies des pièces; il " +
      "les met en commun avec les fonds d'autres utilisateurs et renvoie des pièces " +
      "différentes, en prélevant environ 1 à 3 pour cent, pour brouiller la piste vers la " +
      "source. Contrairement à un CoinJoin non-custodial, tu abandonnes la garde à " +
      "l'opérateur, qui pourrait voler les fonds, les journaliser, ou être contraint de les " +
      "divulguer, donc il y a un risque de contrepartie et de confidentialité en plus de " +
      "tout le reste. C'est la catégorie qui porte l'exposition réglementaire la plus lourde. " +
      "La répression documentée inclut Blender.io (sanctionné par le Trésor américain en 2022 " +
      "pour du blanchiment nord-coréen) et ChipMixer (saisi en mars 2023 avec environ 46 " +
      "millions de dollars). Tornado Cash, un contrat non-custodial plutôt qu'un tumbler, a " +
      "été sanctionné le 8 août 2022; la cour d'appel du Cinquième Circuit américain a ensuite " +
      "jugé le 26 novembre 2024 que ses contrats immuables n'étaient pas des biens " +
      "sanctionnables, et le Trésor l'a retiré de la liste SDN le 21 mars 2025. Les règles " +
      "diffèrent selon la juridiction et bougent vite.",
    retrievalHints: ["mélangeur", "mixeur", "tumbler", "mélangeur de pièces", "tornado cash", "blender", "chipmixer"],
  },
  FICHE_KYC_EXPOSURE: {
    title: "Exposition KYC",
    summary: "Acheter via un service KYC lie durablement ton identité à tes pièces et à leur historique; retirer en auto-conservation ne l'efface pas.",
    body:
      "Acquérir des bitcoins via un service KYC (une plateforme qui vérifie ton identité) " +
      "crée un lien durable entre ton identité civile, ton historique d'achats et les pièces " +
      "que tu retires. Passer en auto-conservation ne supprime pas ce registre: la plateforme " +
      "sait toujours vers quelles adresses tu as retiré, et elle peut être piratée, assignée " +
      "en justice, ou vendre des données. Une base KYC fuitée, noms, adresses de domicile, " +
      "pièces d'identité, avoirs, transforme un problème de confidentialité en un problème de " +
      "sécurité physique (hameçonnage, extorsion, cambriolage). La confidentialité commence " +
      "donc à l'acquisition, pas seulement à la dépense. Si tu utilises du KYC, garde les " +
      "pièces KYC et non-KYC dans des compartiments séparés avec étiquettes et contrôle des " +
      "pièces, et ne les fusionne jamais.",
    retrievalHints: ["KYC", "connaître son client", "plateforme d'échange", "fuite de données", "liaison d'identité", "vérification d'identité"],
  },
  FICHE_NON_KYC_ACQUISITION: {
    title: "Acquisition sans KYC (pair à pair)",
    summary: "Acheter des bitcoins en pair à pair évite de confier ton identité à une plateforme, au prix d'un risque de contrepartie et de sécurité personnelle.",
    body:
      "Acquérir des bitcoins en pair à pair, directement d'une autre personne ou via une " +
      "plateforme de mise en relation, évite la collecte centralisée d'identité d'une " +
      "plateforme KYC. RoboSats est un échange P2P non-custodial qui règle via Lightning avec " +
      "des identités robots éphémères et sans compte, accessible via Tor. Bisq est un échange " +
      "de bureau décentralisé et non-custodial sans KYC, utilisant un séquestre multisig 2 " +
      "sur 2 sur un réseau pair à pair. Les deux échangent de la confidentialité contre " +
      "d'autres risques: risque de contrepartie et d'arnaque, une prime de prix, la gestion " +
      "des litiges, et, pour les rendez-vous en espèces, la sécurité physique. Les montants et " +
      "les méthodes doivent correspondre à ton modèle de menace, et le P2P n'est jamais sans " +
      "risque.",
    retrievalHints: ["sans KYC", "non-KYC", "échange P2P", "robosats", "bisq", "pair à pair", "acquisition P2P"],
  },
  FICHE_OWN_NODE: {
    title: "Utilise ton propre nœud (et Tor)",
    summary: "Connecte ton portefeuille à ton propre nœud pour ne pas révéler tes adresses à un serveur tiers, et passe par Tor pour cacher ton IP.",
    body:
      "Quand un portefeuille parle à un serveur tiers (un explorateur de blocs ou un backend " +
      "de portefeuille léger), ce serveur apprend quelles adresses sont les tiennes et l'IP " +
      "depuis laquelle tu te connectes. Faire tourner ton propre nœud et y pointer ton " +
      "portefeuille garde cette recherche à la maison, si bien qu'aucun tiers ne voit ton " +
      "ensemble d'adresses. Router la connexion via Tor cache ton IP et, au moment de la " +
      "diffusion, aide contre le traçage d'origine au niveau réseau (des techniques comme " +
      "Dandelion et le Transport P2P v2 durcissent la première propagation). Les projets de " +
      "nœud clé en main (Umbrel, Start9, RoninDojo, Dojo) rendent cela praticable. Cela " +
      "traite directement le point faible d'un explorateur hébergé: le serveur qui voit ce " +
      "que tu consultes.",
    retrievalHints: ["propre nœud", "nœud complet", "nœud personnel", "tor", "dandelion", "confidentialité réseau", "umbrel", "start9", "ronindojo", "dojo"],
  },
  FICHE_TOR: {
    title: "Tor",
    summary: "Route ton trafic par plusieurs relais pour cacher ton IP et atteindre les services .onion. Protège la couche réseau, pas l'ensemble du tableau.",
    body:
      "Tor envoie ton trafic par plusieurs relais bénévoles, en le chiffrant à chaque saut, " +
      "de sorte que les sites que tu atteins ne voient pas ta vraie IP et que ton réseau " +
      "local ou ton fournisseur d'accès ne voit pas où tu vas; il atteint aussi les services " +
      ".onion. Il protège la seule couche réseau, pas la sécurité du site ni de l'appareil, " +
      "et ce n'est pas magique: un comportement imprudent, se connecter à un compte nominatif, " +
      "ou mélanger des sessions Tor et non-Tor peut encore te corréler. Pour Bitcoin c'est " +
      "important parce qu'il cache l'IP derrière les connexions de ton portefeuille et de ton " +
      "nœud et derrière tes diffusions. Il est légal et largement utilisé par des " +
      "journalistes, des chercheurs et des personnes sous censure.",
    retrievalHints: ["tor", "onion", "anonymat réseau", "cacher son IP", "relais"],
  },
  FICHE_GRAPHENEOS: {
    title: "GrapheneOS",
    summary: "Un système d'exploitation durci et axé sur la vie privée, basé sur Android, pour les téléphones Pixel, quand un appareil détient des clés ou des applis sensibles.",
    body:
      "GrapheneOS est un système d'exploitation open source et durci, basé sur l'Android Open " +
      "Source Project, axé sur la sécurité et la vie privée. Il retire les services Google par " +
      "défaut (avec une couche Play optionnelle mise en bac à sable), ajoute une forte " +
      "isolation des applis et un contrôle granulaire des permissions, et livre des mises à " +
      "jour de sécurité rapides. Il ne tourne que sur les appareils Google Pixel, qui " +
      "fournissent l'attestation matérielle sur laquelle il s'appuie. Pour un bitcoineur, le " +
      "système mobile est souvent le maillon faible, un téléphone qui détient un portefeuille " +
      "Lightning, de la 2FA, ou des communications sensibles, et GrapheneOS réduit " +
      "significativement cette surface d'attaque.",
    retrievalHints: ["grapheneos", "android durci", "pixel", "sécurité du système mobile", "dégooglisé"],
  },
  FICHE_VPN: {
    title: "Le VPN et ses limites",
    summary: "Un VPN déplace la confiance de ton fournisseur d'accès vers le fournisseur de VPN. Utile sur un Wi-Fi non fiable, mais il ne te rend pas anonyme.",
    body:
      "Un VPN chiffre le trafic entre ton appareil et un fournisseur de VPN, cachant ton " +
      "activité au réseau local et à ton fournisseur d'accès, mais il transfère cette " +
      "visibilité au fournisseur, qui devient un point d'observation unique. Il ne te rend " +
      "pas anonyme et il est souvent survendu. Il aide réellement sur un Wi-Fi non fiable et " +
      "contre un fournisseur d'accès fouineur. Pour Bitcoin, traite-le comme une couche parmi " +
      "d'autres à côté de Tor, de ton propre nœud et d'un modèle de menace clair, pas comme un " +
      "substitut; un fournisseur qui journalise ou est compromis peut annuler le bénéfice.",
    retrievalHints: ["vpn", "mullvad", "fournisseur d'accès", "wifi", "confidentialité réseau"],
  },
  FICHE_PASSWORD_MANAGER: {
    title: "Gestionnaire de mots de passe",
    summary: "Générer et stocker un mot de passe unique et fort par compte, pour qu'une seule fuite ne fasse pas boule de neige.",
    body:
      "Un gestionnaire de mots de passe génère, stocke et remplit un mot de passe unique et " +
      "fort pour chaque compte, ce qui supprime la réutilisation de mot de passe, la raison " +
      "pour laquelle un seul site fuité en compromet beaucoup. Protège-le avec un mot de passe " +
      "maître fort et mémorisable, et sauvegarde la base selon un plan clair. Il aide aussi à " +
      "repérer les faux domaines de connexion, puisqu'il ne remplira pas automatiquement sur " +
      "un site sosie. Il ne remplace pas l'authentification à deux facteurs sur les comptes " +
      "critiques (courriel, plateformes d'échange, cloud). C'est l'une des améliorations de " +
      "sécurité au meilleur rapport effort/bénéfice que tu puisses faire.",
    retrievalHints: ["gestionnaire de mots de passe", "mot de passe fort", "réutilisation de mot de passe", "bitwarden", "identifiants"],
  },
  FICHE_2FA: {
    title: "Authentification à deux facteurs",
    summary: "Ajouter un second facteur au-delà du mot de passe; préfère les applis (TOTP) ou les clés matérielles au SMS.",
    body:
      "L'authentification à deux facteurs ajoute une seconde étape à la connexion au-delà du " +
      "mot de passe. Les facteurs ne sont pas égaux: les codes par SMS ne prouvent que la " +
      "possession d'un numéro de téléphone, qu'un attaquant peut détourner par un SIM swap " +
      "(rediriger ton numéro vers sa carte SIM pour capter les codes), donc les personnalités " +
      "publiques et les détenteurs de bitcoins connus sont des cibles de choix. Préfère le " +
      "TOTP par application, et les clés de sécurité matérielles (FIDO2), qui résistent " +
      "fortement à l'hameçonnage. Enregistre les codes de récupération hors ligne. La 2FA " +
      "protège les comptes (courriel, plateformes d'échange, cloud), mais elle ne fait rien " +
      "pour une graine Bitcoin déjà exposée, qui est protégée par la conservation, pas par des " +
      "facteurs de connexion.",
    retrievalHints: ["2FA", "double authentification", "TOTP", "clé matérielle", "FIDO2", "sim swap"],
  },
  FICHE_DISK_ENCRYPTION: {
    title: "Chiffrement intégral du disque",
    summary: "Chiffrer les appareils et les sauvegardes au repos, pour qu'un disque perdu ou volé ne livre pas tes fichiers de portefeuille.",
    body:
      "Le chiffrement intégral du disque protège les données au repos: si un ordinateur, un " +
      "téléphone ou un disque externe est perdu ou volé alors qu'il est verrouillé ou éteint, " +
      "le contenu reste illisible sans la phrase secrète. Il ne protège pas contre un " +
      "logiciel malveillant qui tourne pendant que la machine est déverrouillée, donc c'est " +
      "une base, pas une défense complète. Chiffre aussi les disques externes et les " +
      "sauvegardes s'ils contiennent quoi que ce soit de sensible, y compris les fichiers de " +
      "portefeuille et les sauvegardes de graine. Garde la phrase de récupération en sûreté: " +
      "la perdre et les données sont perdues. C'est une mesure de base pour les journalistes, " +
      "les bitcoineurs et quiconque manipule des données sensibles.",
    retrievalHints: ["chiffrement intégral du disque", "chiffrement de l'appareil", "veracrypt", "données au repos"],
  },
  FICHE_PHISHING: {
    title: "Hameçonnage et ingénierie sociale",
    summary: "Te manipuler pour t'arracher des secrets ou des paiements. La plupart des pertes en Bitcoin viennent de là, pas d'une cryptographie cassée.",
    body:
      "L'hameçonnage et l'ingénierie sociale manipulent la personne plutôt que la " +
      "cryptographie, et la plupart des pertes en Bitcoin arrivent ainsi, pas en cassant le " +
      "chiffrement. Ils exploitent l'urgence, la peur, l'autorité, l'avidité ou la routine, " +
      "par courriel, SMS, réseaux sociaux, faux sites, appels ou faux support. En Bitcoin ils " +
      "visent les graines, les mots de passe, les codes 2FA, les fausses mises à jour de " +
      "portefeuille et le support usurpé. Les défenses sont des mots de passe uniques, une " +
      "vraie 2FA, et vérifier les URL avant d'agir. La règle la plus claire: aucun support, " +
      "portefeuille ou service légitime ne te demandera jamais ta phrase de récupération.",
    retrievalHints: ["hameçonnage", "ingénierie sociale", "arnaque", "faux support", "arnaque à la phrase de récupération"],
  },
  FICHE_QUANTUM_EXPOSURE: {
    title: "Exposition quantique des clés",
    summary: "Une adresse déjà dépensée ou Taproot a sa clé publique on-chain; ce sont ces pièces qu'un futur ordinateur quantique pourrait viser en premier.",
    body:
      "Quand tu dépenses depuis une adresse Bitcoin, sa clé publique est publiée on-chain pour " +
      "toujours, et une sortie Taproot publie la clé immédiatement. Une adresse qui n'a fait " +
      "que recevoir, et n'est pas Taproot, garde sa clé cachée derrière un hachage. Cela " +
      "importe pour une menace précise et encore hypothétique: un ordinateur quantique à " +
      "grande échelle pourrait, en théorie, dériver une clé privée à partir d'une clé publique " +
      "exposée. Les fonds posés sur une adresse à clé exposée sont ceux le plus à risque dans " +
      "ce scénario, et la réutilisation aggrave les choses, puisque chaque dépense ré-expose " +
      "la clé. Il n'y a aucune urgence aujourd'hui et aucune machine capable de cela n'existe, " +
      "mais l'habitude peu coûteuse et tournée vers l'avenir est la même que pour la vie " +
      "privée: utilise une adresse neuve par paiement, et pour les avoirs de long terme garde " +
      "les fonds sur des adresses jamais dépensées et non Taproot. Déplacer des pièces hors " +
      "d'une clé exposée la recache.",
    retrievalHints: ["quantique", "informatique quantique", "exposition de clé publique", "shor", "post-quantique", "clé taproot"],
  },
};
