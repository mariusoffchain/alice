export type AliceCapabilityId =
  | 'text-generation'
  | 'knowledge-retrieval'
  | 'image-generation'
  | 'diagram-generation'
  | 'wallet-read'
  | 'wallet-action';

export type AliceCapability = {
  id: AliceCapabilityId;
  output: 'text' | 'knowledge' | 'image' | 'diagram' | 'wallet-data' | 'wallet-action';
  availability: 'available' | 'planned';
  privacy: 'on-device' | 'encrypted-cloud' | 'provider-dependent';
  requiresUserConfirmation: boolean;
};

export const ALICE_CAPABILITIES: readonly AliceCapability[] = [
  {
    id: 'text-generation',
    output: 'text',
    availability: 'available',
    privacy: 'encrypted-cloud',
    requiresUserConfirmation: false,
  },
  {
    id: 'knowledge-retrieval',
    output: 'knowledge',
    availability: 'available',
    privacy: 'on-device',
    requiresUserConfirmation: false,
  },
  {
    id: 'image-generation',
    output: 'image',
    availability: 'planned',
    privacy: 'provider-dependent',
    requiresUserConfirmation: false,
  },
  {
    id: 'diagram-generation',
    output: 'diagram',
    availability: 'planned',
    privacy: 'provider-dependent',
    requiresUserConfirmation: false,
  },
  {
    id: 'wallet-read',
    output: 'wallet-data',
    availability: 'planned',
    privacy: 'on-device',
    requiresUserConfirmation: false,
  },
  {
    id: 'wallet-action',
    output: 'wallet-action',
    availability: 'planned',
    privacy: 'on-device',
    requiresUserConfirmation: true,
  },
] as const;

export function getAliceCapability(id: AliceCapabilityId): AliceCapability {
  const capability = ALICE_CAPABILITIES.find(item => item.id === id);
  if (!capability) throw new Error(`Unknown Alice capability: ${id}`);
  return capability;
}
