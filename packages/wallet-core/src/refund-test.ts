import AsyncStorage from '@react-native-async-storage/async-storage';

const REFUND_TEST_KEY = 'alice_refund_test_once';

export async function isRefundTestArmed(): Promise<boolean> {
  return (await AsyncStorage.getItem(REFUND_TEST_KEY)) === 'true';
}

export async function armRefundTest(): Promise<void> {
  await AsyncStorage.setItem(REFUND_TEST_KEY, 'true');
}

export async function disarmRefundTest(): Promise<void> {
  await AsyncStorage.removeItem(REFUND_TEST_KEY);
}

/** Returns true once, then immediately disarms the test. */
export async function consumeRefundTest(): Promise<boolean> {
  if (!(await isRefundTestArmed())) return false;
  await disarmRefundTest();
  return true;
}
