# Lots de traduction du corpus RAG

## Objet

Cette sélection fige les 200 concepts issus de la catégorie A du rapport de triage qui doivent être évalués pour le cœur actif. Elle évite une promotion massive des 961 candidats et répartit le travail en lots contrôlables.

Règles pour chaque lot :

- conserver la note française comme source ;
- ajouter une jumelle anglaise liée au même `conceptId` ;
- conserver `status: "machine"` jusqu'à une relecture humaine ;
- conserver les sources traduites dans le pack secondaire tant que les empreintes du cœur ne peuvent pas être régénérées ;
- régénérer le corpus, puis exécuter les tests avant le lot suivant ;
- ne pas régénérer les index `core-embeddings`.

## État

- Sélection figée : 200 concepts
- Lot 1 : 25 concepts de self-custody et récupération traduits, activation différée
- Lots suivants : 175 concepts
- Date de lancement : 2026-08-21

L'activation dans le cœur est différée. Le test d'intégration exige que les index web et natif couvrent exactement le cœur actif. Une promotion sans régénération de `core-embeddings` ferait donc échouer la suite, tandis que leur régénération est explicitement exclue de cette mission.

## Lot 1 : self-custody et récupération, 25

```text
bitcoin__bip32
bitcoin__bip39-checksum
bitcoin__bip39-mnemonic-phrase
bitcoin__bip39-word-list
bitcoin__bip44
bitcoin__bip84
bitcoin__bip85
bitcoin__bitcoin-key-pair
bitcoin__bitcoin-private-key
bitcoin__bitcoin-public-key
bitcoin__bitcoin-seed
bitcoin__chain-code
bitcoin__child-key-derivation
bitcoin__derivation-path
bitcoin__deterministic-wallet
bitcoin__entropy
bitcoin__extended-key
bitcoin__extended-private-key
bitcoin__extended-public-key
bitcoin__hd-account
bitcoin__hd-wallet
bitcoin__hardened-derivation
bitcoin__non-hardened-derivation
bitcoin__random-number-generation
bitcoin__watch-only-wallet
```

## Transactions et paiements, 25

```text
tx-model__bitcoin-transaction
tx-model__bitcoin-transaction-structure
tx-model__transaction-malleability
bitcoin__batched-spending
bitcoin__bitcoin-payment-conversion-policy
bitcoin__bitcoin-payment-processor
bitcoin__bitcoin-payment-solution-selection
bitcoin__bitcoin-payments-for-merchants
bitcoin__bitcoin-uri
bitcoin__coin-selection
bitcoin__exchange-rate-risk
bitcoin__free-and-open-source-software
bitcoin__lnurl-auth
bitcoin__partially-signed-bitcoin-transaction
bitcoin__payment-system-costs
bitcoin__self-hosted-payment-processor
bitcoin__traditional-payment-systems
bitcoin__wallet-as-identity
bitcoin__bitcoin-scalability-criticism
bitcoin__bitcoin-scaling
bitcoin__block-weight
bitcoin__horizontal-scaling
bitcoin__inward-scaling
bitcoin__off-chain
bitcoin__vertical-scaling
```

## Confidentialité et sécurité opérationnelle, 25

```text
privacy__non-blockchain-privacy-leaks
privacy__blockchain-privacy-leaks
privacy__bitcoin-pseudonymity
privacy__silent-payments
privacy__utxo-labeling
privacy__toxic-change
privacy__transaction-heuristics
privacy__bitcoin-chain-analysis
opsec__personal-digital-security
opsec__secure-backups
opsec__software-download-hygiene
opsec__phishing-and-social-engineering
opsec__malware
opsec__hardware-security-key
opsec__data-breach-monitoring
privacy__address-spoofing
privacy__anonymity-sets
privacy__bip47-reusable-payment-codes
privacy__backup-3-2-1-method
privacy__bitcoin-p2p-privacy
privacy__bitcoin-privacy-measures
privacy__bitcoin-transaction-patterns
privacy__browser-security
privacy__consolidation-transaction
privacy__kyc-bitcoin-acquisition
```

## Sécurité Bitcoin, 15

```text
bitcoin__51-attack
bitcoin__adversarial-thinking
bitcoin__attack-surface
bitcoin__bgp-hijacking
bitcoin__bip38-encrypted-private-key
bitcoin__backdoor
bitcoin__bitcoin-practical-key-management
bitcoin__bitcoin-quantum-threat
bitcoin__bitcoin-security-assumptions
bitcoin__brute-force-attack
bitcoin__eclipse-attack
bitcoin__responsible-disclosure
bitcoin__sybil-attack
bitcoin__threat-model
bitcoin__weak-rng-wallet-incidents
```

## Lightning, 15

```text
lightning__channel-closure
lightning__watchtower
lightning__lnurl
lightning__keysend
lightning__lightning-payments
lightning__lightning-address
lightning__bolt11-invoice
lightning__bolt12-offers
lightning__ptlc
lightning__blinded-paths
lightning__commitment-transaction
lightning__lightning-loop
lightning__onion-routing
lightning__replacement-cycling-attack
lightning__revocation-key
```

## Ark et Arkade, 10

```text
arkade__ark-fees-and-liquidity
arkade__ark-boarding-offboarding-and-exits
arkade__ark-rounds-and-batch-settlement
arkade__ark-implementations-second-bark-et-arkade
arkade__second-bark
arkade__ark-lightning-gateway
ark__atlc
ark__arkade-addresses
ark__arkade-assets
ark__vhtlc
```

## Nœuds et réseau, 15

```text
nodes__pruned-node
nodes__spv-node
nodes__wallet-node-connection
nodes__utxo-set
nodes__bitcoin-mempool-policy
nodes__bitcoin-p2p-network
nodes__bitcoin-core
bitcoin__asmap
bitcoin__bip158
bitcoin__bitcoin-p2p-handshake
bitcoin__block-synchronization
bitcoin__bloom-filters
bitcoin__compact-block-filters
bitcoin__dns-seeds
bitcoin__merkle-proof
```

## Minage, 15

```text
mining__bitcoin-security-budget
mining__solo-bitcoin-mining
mining__gas-flaring-bitcoin-mining
bitcoin__asic-heat-reuse
bitcoin__asic-mining
bitcoin__asic-noise-reduction
bitcoin__asic-thermal-management
bitcoin__hashrate
bitcoin__miner-decentralization
bitcoin__mining-centralization
bitcoin__mining-difficulty
bitcoin__mining-pool
bitcoin__pool-payout-methods
bitcoin__stranded-energy-mining
bitcoin__sustainable-bitcoin-mining
```

## Adresses et scripts, 10

```text
addresses__bitcoin-address
addresses__legacy-address
addresses__segwit-address
addresses__bech32
addresses__bech32m
addresses__p2sh
addresses__bitcoin-script
addresses__timelock
addresses__hashlock
addresses__mast
```

## Fondamentaux Bitcoin, 20

```text
bitcoin__5-wrench-attack
bitcoin__altcoin-risk
bitcoin__atomic-swap
bitcoin__bitcoin-covenants
bitcoin__bitcoin-exchange
bitcoin__bitcoin-layered-architecture
bitcoin__bitcoin-monetary-standard-transition
bitcoin__custodial-wallet
bitcoin__double-spending
bitcoin__auditable-monetary-policy
bitcoin__bitcoin-base-layer
bitcoin__bitcoin-censorship-resistance
bitcoin__bitcoin-consensus
bitcoin__bitcoin-decentralization
bitcoin__bitcoin-finite-supply
bitcoin__bitcoin-monetary-policy
bitcoin__bitcoin-network-vs-asset
bitcoin__bitcoin-permissionlessness
bitcoin__bitcoin-supply-verification
bitcoin__trusted-third-party-problem
```

## Usages sociaux et politiques, 15

```text
politics__bitcoin-self-custody-under-censorship
politics__euro-numerique
politics__bitcoin-and-central-banks
geopolitics__bitcoin-in-iran
social-utility__unbanked-population
social-utility__women-financial-empowerment-with-bitcoin
politics__el-salvador-bitcoin-adoption
bitcoin__bitcoin-adoption
bitcoin__bitcoin-ban-preparedness
bitcoin__bitcoin-circular-economy
bitcoin__bitcoin-education
bitcoin__bitcoin-ekasi
bitcoin__aml-bitcoin-regulation
bitcoin__bitcoin-cross-border-jurisdiction-risk
bitcoin__mica
```

## Histoire, 5

```text
history__bitcoin-network-launch
history__first-bitcoin-transaction
history__genesis-block-message
history__satoshi-disappearance
history__hashcash
```

## Wallets et développement avancés, 5

```text
advanced-wallet__bitcoin-multisignature
advanced-wallet__liana-wallet
dev-fundamentals__bitcoin-improvement-proposal
dev-fundamentals__bitcoin-privacy-problem
advanced-wallet__descriptor-wallet
```
