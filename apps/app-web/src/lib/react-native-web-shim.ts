export const Platform = {
  OS: 'web' as string,
  select: <T>(specifics: { web?: T; default?: T }): T | undefined =>
    specifics.web ?? specifics.default,
};

export const Keyboard = {
  addListener: () => ({ remove: () => {} }),
  dismiss: () => {},
};

export const AppState = {
  currentState: 'active' as const,
  addEventListener: () => ({ remove: () => {} }),
};
