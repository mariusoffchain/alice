export type PaymentNetwork = 'mutinynet' | 'bitcoin';

export type PaymentLayer = 'arkade' | 'onchain' | 'lightning';
export type PaymentInputKind =
  | 'arkade-address'
  | 'bitcoin-address'
  | 'bip21'
  | 'bolt11'
  | 'lnurl'
  | 'lightning-address';

export type LightningFormat = 'bolt11' | 'lnurl' | 'lightning-address';

export type PaymentRoute =
  | { layer: 'arkade'; destination: string }
  | { layer: 'onchain'; destination: string }
  | { layer: 'lightning'; destination: string; format: LightningFormat };

export interface ParsedPaymentRequest {
  raw: string;
  kind: PaymentInputKind;
  network: PaymentNetwork;
  amountSats: number | null;
  routes: PaymentRoute[];
}

export interface PaymentQuote {
  id: string;
  provider: string;
  layer: PaymentLayer;
  request: ParsedPaymentRequest;
  sendAmountSats: number;
  receiveAmountSats: number;
  feeSats: number;
  expiresAt: number | null;
  warnings: string[];
  providerData?: unknown;
}

export type PaymentStatus =
  | 'created'
  | 'quoted'
  | 'pending'
  | 'settled'
  | 'failed'
  | 'expired'
  | 'refundable'
  | 'refunded';

export interface PaymentRecord {
  id: string;
  provider: string;
  layer: PaymentLayer;
  direction: 'incoming' | 'outgoing';
  amountSats: number;
  feeSats: number;
  status: PaymentStatus;
  createdAt: number;
  expiresAt: number | null;
  txid?: string;
  swapId?: string;
  preimage?: string;
  refundable: boolean;
  providerData?: unknown;
}

export interface ReceivePaymentRequest {
  layer: PaymentLayer;
  amountSats: number | null;
  description?: string;
  targetArkadeAddress?: string;
}

export interface ReceivePaymentResponse {
  request: string;
  layer: PaymentLayer;
  amountSats: number | null;
  expiresAt: number | null;
  paymentId?: string;
  paymentAmountSats?: number;
  feeSats?: number;
  provider?: string;
}
